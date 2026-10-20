// SPDX-License-Identifier: Apache-2.0
/**
 * The terminals of the host: one PTY (`Bun.Terminal`) per terminal ID, in the checkout that is open at the start.
 * The kind `claude` runs the `claude` CLI. The kind `shell` runs
 * `$SHELL -il`.
 *
 * The host gives the bytes of the PTY to the page without a change, as UTF-8 text in `terminal.output` events, in
 * batches of `batchMs`. Each terminal keeps a scrollback ring, so a page that opens an existing ID again (a reload)
 * gets the old output first. The host never calls `setRawMode`: the CLI sets raw mode itself.
 *
 * The kind `claude` gets no `ANTHROPIC_API_KEY` unless the request sets `apiKey`: the terminal mode uses the
 * subscription login of the owner. A new folder shows the trust dialog of the CLI in the terminal, and the owner
 * answers it there.
 */
import type {
  EventPayload,
  EventType,
  HostEndpoint,
  HostEvent,
  TerminalExit,
  TerminalKind,
  TerminalOpened,
  TerminalOpenParams,
} from "./protocol";
import { childGroups } from "./children";
import { needString, type Router } from "./router";
import { claudeArgs, TERMINAL_ENV, writeClaudeSettings } from "./settings";
import { RESTART_ENDED_TEXT } from "./hostProtocol";
import { REMOTE_SHELL_REFUSED } from "./remote";

/** The batch time of the output (ms). */
export const OUTPUT_BATCH_MS = 12;
/**
 * The size of the scrollback ring of one terminal (UTF-16 code units, about 2 MB of text). A smaller ring (256 K)
 * holds only the last minutes of the redraws of the CLI. The full transcript comes from the session file ("Export
 * transcript").
 */
export const SCROLLBACK_CHARS = 2 * 1024 * 1024;
/** The time from `close()` (SIGHUP) to SIGKILL (ms). */
export const KILL_AFTER_MS = 2_000;
/** The count of ended terminals that the host keeps for a reload of the page. */
const KEEP_ENDED = 8;

/** The flags and the extra environment of the `claude` CLI (settings.ts). */
export interface ClaudeLaunch {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface TerminalManagerOptions {
  /** Send an event to the pages. */
  readonly emit: (event: HostEvent) => void;
  /** The checkout of a new terminal (its working folder). */
  readonly checkout: () => string;
  /** The environment of the host. The default is `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The program of a kind, without the flags. The default is `claude` and `$SHELL -il`. A test gives others. */
  readonly program?: (kind: TerminalKind, env: Readonly<Record<string, string>>) => readonly string[];
  /** The flags of the CLI (settings.ts). Null or an absent function: the CLI starts without workbench flags. */
  readonly claudeLaunch?: () => Promise<ClaudeLaunch | null>;
  readonly batchMs?: number;
  readonly scrollbackChars?: number;
  readonly killAfterMs?: number;
  /** Refuse `terminal.open` of the kind `shell` (the remote mode, remote.ts). The default is false. */
  readonly refuseShell?: boolean;
  /** The session ID of a new `claude` terminal (`--session-id`, or the ID of `--resume`). */
  readonly onSession?: (entry: { terminal: string; session: string; checkout: string }) => void;
}

/** A `claude` terminal for the session records. */
export interface ClaudeTerminalInfo {
  readonly id: string;
  readonly checkout: string;
  /** The start time (ms since the epoch). */
  readonly startedMs: number;
  readonly live: boolean;
}

/** The variables of an outer Claude Code session. A host that runs inside a session must not give them to a child. */
const SESSION_VARIABLES =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SSE_PORT|CHILD_SESSION|SESSION_\w+|MESSAGING_\w+))$/;
/** The variables of the terminal program of the host. xterm.js in the page is another program. */
const TERMINAL_VARIABLES = new Set(["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "ITERM_SESSION_ID"]);

/**
 * The environment of a PTY: the environment of the host without the variables of an outer Claude Code session and
 * of the terminal program, with `TERM` and `COLORTERM`. The kind `claude` has no `ANTHROPIC_API_KEY` unless `apiKey`.
 */
export function terminalEnv(
  base: Readonly<Record<string, string | undefined>>,
  kind: TerminalKind,
  apiKey = false,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || SESSION_VARIABLES.test(key) || TERMINAL_VARIABLES.has(key)) continue;
    if (key === "ANTHROPIC_API_KEY" && kind === "claude" && !apiKey) continue;
    env[key] = value;
  }
  return { ...env, ...extra, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

/** The default program of a kind. Throw an error when `claude` is not on the `PATH` of the host. */
export function defaultProgram(kind: TerminalKind, env: Readonly<Record<string, string>>): readonly string[] {
  if (kind === "shell") return [env.SHELL ?? "/bin/zsh", "-il"];
  const claude = Bun.which("claude", { PATH: env.PATH ?? "" });
  if (claude === null) throw new Error("The claude CLI is not on the PATH of the host.");
  return [claude];
}

/**
 * The CLI flags of the workbench: write the MCP config and the settings into the state folder at each start
 * of a `claude` terminal (the port and the token change per host start), and give `--mcp-config` and `--settings`
 * with the environment of the hooks.
 */
export function settingsLaunch(
  stateDir: string,
  endpoint: HostEndpoint,
  checkouts: () => readonly string[],
): () => Promise<ClaudeLaunch> {
  return () => {
    const files = writeClaudeSettings({ stateDir, endpoint, forbidden: checkouts() });
    return Promise.resolve({ args: claudeArgs(files), env: files.env });
  };
}

/** A ring of text: it keeps the last `limit` code units. */
export class ScrollRing {
  readonly #limit: number;
  #chunks: string[] = [];
  #size = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(text: string): void {
    if (text === "") return;
    this.#chunks.push(text);
    this.#size += text.length;
    while (this.#size > this.#limit) {
      const head = this.#chunks[0] ?? "";
      const excess = this.#size - this.#limit;
      if (head.length <= excess) this.#chunks.shift();
      else this.#chunks[0] = head.slice(excess);
      this.#size -= Math.min(head.length, excess);
    }
  }

  text(): string {
    if (this.#chunks.length > 1) this.#chunks = [this.#chunks.join("")];
    return this.#chunks[0] ?? "";
  }
}

function checkSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const good = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!good(cols) || !good(rows)) throw new Error('The parameters "cols" and "rows" must be sizes.');
  // A very small screen (a narrow, short window) gets the smallest PTY, not an error.
  return { cols: Math.min(1000, Math.max(2, cols)), rows: Math.min(500, Math.max(2, rows)) };
}

const SESSION_ID = /^[\w-]{1,128}$/;

/** Check the parameters of `terminal.open` that the size check does not cover. */
function checkOpen(params: TerminalOpenParams): void {
  const kind: unknown = params.kind;
  if (kind !== "claude" && kind !== "shell") throw new Error('The parameter "kind" is not valid.');
  const { terminal, resume, apiKey } = params as { terminal?: unknown; resume?: unknown; apiKey?: unknown };
  if (terminal !== undefined && typeof terminal !== "string")
    throw new Error('The parameter "terminal" must be a text.');
  if (resume !== undefined && (typeof resume !== "string" || !SESSION_ID.test(resume))) {
    throw new Error('The parameter "resume" must be a session ID.');
  }
  if (apiKey !== undefined && typeof apiKey !== "boolean")
    throw new Error('The parameter "apiKey" must be true or false.');
}

function event<T extends EventType>(type: T, payload: EventPayload<T>): HostEvent {
  return { type, ...payload } as HostEvent;
}

interface PtySpec {
  readonly id: string;
  readonly kind: TerminalKind;
  readonly checkout: string;
  readonly cmd: readonly string[];
  readonly env: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

interface PtyDeps {
  readonly emit: (event: HostEvent) => void;
  readonly batchMs: number;
  readonly scrollbackChars: number;
}

/** One PTY and its process. */
class Pty {
  readonly id: string;
  readonly kind: TerminalKind;
  readonly checkout: string;
  readonly startedMs = Date.now();
  readonly ended: Promise<TerminalExit>;
  exit: TerminalExit | null = null;
  readonly #deps: PtyDeps;
  readonly #ring: ScrollRing;
  readonly #decoder = new TextDecoder();
  readonly #proc: Bun.Subprocess;
  readonly #terminal: Bun.Terminal;
  #pending = "";
  #timer: ReturnType<typeof setTimeout> | null = null;
  #size: { cols: number; rows: number };
  #kill: ReturnType<typeof setTimeout> | null = null;

  constructor(spec: PtySpec, deps: PtyDeps) {
    this.id = spec.id;
    this.kind = spec.kind;
    this.checkout = spec.checkout;
    this.#deps = deps;
    this.#ring = new ScrollRing(deps.scrollbackChars);
    this.#size = { cols: spec.cols, rows: spec.rows };
    let eof: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (eof = resolve));
    this.#proc = Bun.spawn([...spec.cmd], {
      cwd: spec.checkout,
      env: spec.env,
      terminal: {
        cols: spec.cols,
        rows: spec.rows,
        name: "xterm-256color",
        data: (_terminal, data) => this.#data(data),
        exit: () => eof(),
      },
    });
    // The PTY program leads a group of its own. The group goes into children.json until it ends.
    childGroups.add(this.#proc.pid, `${spec.kind} terminal`, spec.cmd[0] ?? "");
    const terminal = this.#proc.terminal;
    if (terminal === undefined) throw new Error("Bun.spawn gave no terminal.");
    this.#terminal = terminal;
    this.ended = this.#watchExit(closed);
  }

  write(data: string): void {
    if (this.exit === null && !this.#terminal.closed) this.#terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exit !== null || this.#terminal.closed) return;
    this.#size = { cols, rows };
    this.#terminal.resize(cols, rows);
  }

  /** Give the scrollback and the exit for a page that opens this terminal again. Make the program draw again. */
  attach(cols: number, rows: number): { replay: string; exit: TerminalExit | null } {
    this.#flush();
    const same = this.#size.cols === cols && this.#size.rows === rows;
    // The same size sends no SIGWINCH. A size of one column less, then the size, makes the program draw again.
    if (same && cols > 2) this.resize(cols - 1, rows);
    this.resize(cols, rows);
    return { replay: this.#ring.text(), exit: this.exit };
  }

  /** Close the PTY (SIGHUP); send SIGKILL to the process group after `killAfterMs`. */
  close(killAfterMs: number): Promise<TerminalExit> {
    if (this.exit === null && this.#kill === null) {
      this.#kill = setTimeout(() => this.killNow(), killAfterMs);
      this.#terminal.close();
    }
    return this.ended;
  }

  /** Send SIGKILL to the process group immediately. */
  killNow(): void {
    if (this.exit !== null) return;
    const pid = this.#proc.pid;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      this.#proc.kill("SIGKILL");
    }
  }

  #data(data: Uint8Array): void {
    this.#pending += this.#decoder.decode(data, { stream: true });
    this.#timer ??= setTimeout(() => this.#flush(), this.#deps.batchMs);
  }

  #flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const data = this.#pending;
    this.#pending = "";
    if (data === "") return;
    this.#ring.push(data);
    this.#deps.emit(event("terminal.output", { terminal: this.id, data }));
  }

  async #watchExit(closed: Promise<void>): Promise<TerminalExit> {
    await this.#proc.exited;
    childGroups.remove(this.#proc.pid);
    // A grandchild can keep the PTY open. The host waits for the end of the output at most 200 ms.
    await Promise.race([closed, Bun.sleep(200)]);
    if (this.#kill !== null) clearTimeout(this.#kill);
    this.#pending += this.#decoder.decode();
    this.#flush();
    const exit: TerminalExit = { code: this.#proc.exitCode, signal: this.#proc.signalCode ?? null };
    this.exit = exit;
    if (!this.#terminal.closed) this.#terminal.close();
    this.#deps.emit(event("terminal.exit", { terminal: this.id, ...exit }));
    return exit;
  }
}

/** The terminals of the host. */
export class TerminalManager {
  readonly #options: TerminalManagerOptions;
  readonly #ptys = new Map<string, Pty>();
  /** The terminals that ended with the old host at a restart, by ID. */
  readonly #ended = new Map<string, TerminalKind>();

  constructor(options: TerminalManagerOptions) {
    this.#options = options;
  }

  /** The terminals whose program runs (the restart state of the host). */
  live(): { id: string; kind: TerminalKind }[] {
    return [...this.#ptys.values()].filter((pty) => pty.exit === null).map((pty) => ({ id: pty.id, kind: pty.kind }));
  }

  /** Mark the terminals of an old host as ended: a page that opens one again gets the restart words. */
  markEnded(terminals: readonly { id: string; kind: TerminalKind }[]): void {
    for (const { id, kind } of terminals) this.#ended.set(id, kind);
  }

  /** The IDs of the terminals, the ended ones included. */
  ids(): string[] {
    return [...this.#ptys.keys()];
  }

  /** The `claude` terminals that the host knows, the ended ones included. */
  claudeTerminals(): ClaudeTerminalInfo[] {
    return [...this.#ptys.values()]
      .filter((pty) => pty.kind === "claude")
      .map((pty) => ({ id: pty.id, checkout: pty.checkout, startedMs: pty.startedMs, live: pty.exit === null }));
  }

  /** Open a terminal again (a known ID), or start a new one (no ID, or an ID that the host does not know). */
  async open(params: TerminalOpenParams): Promise<TerminalOpened> {
    checkOpen(params);
    if (params.kind === "shell" && this.#options.refuseShell === true) throw new Error(REMOTE_SHELL_REFUSED);
    const { cols, rows } = checkSize(params.cols, params.rows);
    const known = params.terminal === undefined ? undefined : this.#ptys.get(params.terminal);
    if (params.terminal !== undefined && this.#ended.get(params.terminal) === params.kind) {
      const replay = `\r\n\x1b[33m${RESTART_ENDED_TEXT}\x1b[0m\r\n`;
      const exit = { code: null, signal: "host restart" };
      return {
        terminal: params.terminal,
        kind: params.kind,
        checkout: this.#options.checkout(),
        attached: true,
        replay,
        exit,
      };
    }
    if (known?.kind === params.kind) {
      const { replay, exit } = known.attach(cols, rows);
      return { terminal: known.id, kind: known.kind, checkout: known.checkout, attached: true, replay, exit };
    }
    const pty = await this.#start(params, cols, rows);
    this.#ptys.set(pty.id, pty);
    this.#dropEnded();
    return { terminal: pty.id, kind: pty.kind, checkout: pty.checkout, attached: false, replay: "", exit: null };
  }

  input(id: string, data: string): void {
    this.#get(id).write(data);
  }

  resize(id: string, cols: unknown, rows: unknown): void {
    const size = checkSize(cols, rows);
    this.#get(id).resize(size.cols, size.rows);
  }

  /** End a terminal and forget it. The promise resolves after the exit of its process. */
  async close(id: string): Promise<void> {
    if (this.#ended.delete(id)) return;
    const pty = this.#get(id);
    await pty.close(this.#options.killAfterMs ?? KILL_AFTER_MS);
    this.#ptys.delete(id);
  }

  /** End every terminal (the stop of the host). */
  async closeAll(): Promise<void> {
    await Promise.all(this.ids().map((id) => this.close(id)));
  }

  /** Send SIGKILL to every terminal immediately, without a wait (the exit of the host process). */
  killNow(): void {
    for (const pty of this.#ptys.values()) pty.killNow();
  }

  #get(id: string): Pty {
    const pty = this.#ptys.get(id);
    if (pty === undefined) throw new Error(`The host has no terminal "${id}".`);
    return pty;
  }

  async #start(params: TerminalOpenParams, cols: number, rows: number): Promise<Pty> {
    const base = this.#options.env ?? process.env;
    const id = `${params.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const checkout = this.#options.checkout();
    let extraArgs: readonly string[] = [];
    let extraEnv: Readonly<Record<string, string>> = {};
    if (params.kind === "claude") {
      const launch = (await this.#options.claudeLaunch?.()) ?? null;
      // A new session gets its ID from the host, so the resume and the transcript know it immediately.
      const session = params.resume ?? crypto.randomUUID();
      const sessionArgs = params.resume === undefined ? ["--session-id", session] : ["--resume", params.resume];
      extraArgs = [...(launch?.args ?? []), ...sessionArgs];
      // The hooks send the terminal ID in a header (settings.ts `TERMINAL_HEADER`).
      extraEnv = { ...launch?.env, [TERMINAL_ENV]: id };
      this.#options.onSession?.({ terminal: id, session, checkout });
    }
    const env = terminalEnv(base, params.kind, params.apiKey === true, extraEnv);
    const program = (this.#options.program ?? defaultProgram)(params.kind, env);
    const deps: PtyDeps = {
      emit: this.#options.emit,
      batchMs: this.#options.batchMs ?? OUTPUT_BATCH_MS,
      scrollbackChars: this.#options.scrollbackChars ?? SCROLLBACK_CHARS,
    };
    return new Pty({ id, kind: params.kind, checkout, cmd: [...program, ...extraArgs], env, cols, rows }, deps);
  }

  /** Forget the oldest ended terminals above `KEEP_ENDED`. */
  #dropEnded(): void {
    const ended = [...this.#ptys.values()].filter((pty) => pty.exit !== null);
    for (const pty of ended.slice(0, Math.max(0, ended.length - KEEP_ENDED))) this.#ptys.delete(pty.id);
  }
}

/** Add the handlers of `terminal.open`, `terminal.input`, `terminal.resize` and `terminal.close` to the router. */
export function addTerminalHandlers(router: Router, terminals: TerminalManager): void {
  router
    .on("terminal.open", (params) => terminals.open(params))
    .on("terminal.input", (params) => {
      if (typeof params.data !== "string") throw new Error('The parameter "data" must be a text.');
      terminals.input(needString(params, "terminal"), params.data);
      return null;
    })
    .on("terminal.resize", (params) => {
      terminals.resize(needString(params, "terminal"), params.cols, params.rows);
      return null;
    })
    .on("terminal.close", async (params) => {
      await terminals.close(needString(params, "terminal"));
      return null;
    });
}
