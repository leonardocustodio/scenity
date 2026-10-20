// SPDX-License-Identifier: Apache-2.0
/**
 * The terminals of the studio: one PTY (`Bun.Terminal`) per terminal ID, in the folder of its project. The kind
 * `claude` runs the Claude Code CLI with the MCP server of the studio (`scenity mcp`). The kind `shell` runs
 * `$SHELL -il`. The output goes to the pages as `terminal.output` events (in batches), the end as
 * `terminal.exit`. Each terminal keeps a scrollback ring, so a page that opens it again (a reload) gets its output.
 * The roles of the host apply: a host that refuses shells (the remote mode) refuses the kind `shell`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The kinds of terminal. */
export type TerminalKind = "claude" | "shell";

/** The end of the process of a terminal. */
export interface TerminalExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** A terminal as the API gives it. */
export interface TerminalInfo {
  readonly terminal: string;
  readonly kind: TerminalKind;
  readonly project: string;
  readonly cwd: string;
  readonly exit: TerminalExit | null;
}

/** The answer of an open: the terminal, the flag that tells if it existed before, and its scrollback. */
export interface TerminalOpened extends TerminalInfo {
  readonly attached: boolean;
  readonly replay: string;
}

/** An event of the terminals. */
export type TerminalEvent =
  | { readonly type: "terminal.output"; readonly terminal: string; readonly data: string }
  | ({ readonly type: "terminal.exit"; readonly terminal: string } & TerminalExit);

export interface TerminalOptions {
  emit(event: TerminalEvent): void;
  /** The program of a kind in a folder (a test gives another). */
  program?(kind: TerminalKind, cwd: string, project: string): readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly batchMs?: number;
  readonly scrollbackChars?: number;
  readonly killAfterMs?: number;
  /** True: refuse the kind `shell` (the role rule of a remote host). */
  readonly refuseShell?: boolean;
}

/** The variables of an outer Claude Code session and of the terminal program of the host. */
const DROPPED =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_\w+|TERM_PROGRAM|TERM_PROGRAM_VERSION|TERM_SESSION_ID|ITERM_SESSION_ID)$/;

/** The environment of a PTY. */
export function terminalEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !DROPPED.test(key)) env[key] = value;
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

/** A ring of text: the last `limit` code units. */
export class ScrollRing {
  #text = "";
  constructor(private readonly limit: number) {}
  push(text: string): void {
    this.#text = (this.#text + text).slice(-this.limit);
  }
  text(): string {
    return this.#text;
  }
}

function size(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const good = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!good(cols) || !good(rows)) throw new Error('The parameters "cols" and "rows" must be sizes.');
  return { cols: Math.min(1000, Math.max(2, cols)), rows: Math.min(500, Math.max(2, rows)) };
}

/** One PTY and its process. */
class Pty {
  readonly ring: ScrollRing;
  exit: TerminalExit | null = null;
  readonly ended: Promise<TerminalExit>;
  readonly #decoder = new TextDecoder();
  readonly #proc: Bun.Subprocess;
  readonly #terminal: Bun.Terminal;
  #pending = "";
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly info: Omit<TerminalInfo, "exit">,
    cmd: readonly string[],
    env: Record<string, string>,
    at: { cols: number; rows: number },
    private readonly options: Required<Pick<TerminalOptions, "batchMs">> & Pick<TerminalOptions, "emit">,
    scrollback: number,
  ) {
    this.ring = new ScrollRing(scrollback);
    let eof: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (eof = resolve));
    this.#proc = Bun.spawn([...cmd], {
      cwd: info.cwd,
      env,
      terminal: { ...at, name: "xterm-256color", data: (_terminal, data) => this.#data(data), exit: () => eof() },
    });
    const terminal = this.#proc.terminal;
    if (terminal === undefined) throw new Error("Bun.spawn gave no terminal.");
    this.#terminal = terminal;
    this.ended = this.#watch(closed);
  }

  write(data: string): void {
    if (this.exit === null && !this.#terminal.closed) this.#terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exit === null && !this.#terminal.closed) this.#terminal.resize(cols, rows);
  }

  /** The scrollback for a page that opens the terminal again (the program draws again at a new size). */
  attach(cols: number, rows: number): string {
    this.#flush();
    if (cols > 2) this.resize(cols - 1, rows);
    this.resize(cols, rows);
    return this.ring.text();
  }

  close(killAfterMs: number): Promise<TerminalExit> {
    if (this.exit === null && !this.#terminal.closed) {
      setTimeout(() => {
        if (this.exit === null) this.#proc.kill("SIGKILL");
      }, killAfterMs);
      this.#terminal.close();
    }
    return this.ended;
  }

  #data(data: Uint8Array): void {
    this.#pending += this.#decoder.decode(data, { stream: true });
    this.#timer ??= setTimeout(() => this.#flush(), this.options.batchMs);
  }

  #flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const data = this.#pending;
    this.#pending = "";
    if (data === "") return;
    this.ring.push(data);
    this.options.emit({ type: "terminal.output", terminal: this.info.terminal, data });
  }

  async #watch(closed: Promise<void>): Promise<TerminalExit> {
    await this.#proc.exited;
    await Promise.race([closed, Bun.sleep(200)]);
    this.#pending += this.#decoder.decode();
    this.#flush();
    const exit: TerminalExit = { code: this.#proc.exitCode, signal: this.#proc.signalCode ?? null };
    this.exit = exit;
    if (!this.#terminal.closed) this.#terminal.close();
    this.options.emit({ type: "terminal.exit", terminal: this.info.terminal, ...exit });
    return exit;
  }
}

/** The default program of a kind: the `claude` CLI (an error when it is not on the PATH) or the login shell. */
export function defaultProgram(kind: TerminalKind, env: Readonly<Record<string, string>>): readonly string[] {
  if (kind === "shell") return [env.SHELL ?? "/bin/zsh", "-il"];
  const claude = Bun.which("claude", { PATH: env.PATH ?? "" });
  if (claude === null) throw new Error("The claude CLI is not on the PATH of the studio.");
  return [claude];
}

/** The terminals of the studio. */
export class Terminals {
  readonly #ptys = new Map<string, Pty>();
  #next = 1;

  constructor(private readonly options: TerminalOptions) {}

  list(): TerminalInfo[] {
    return [...this.#ptys.values()].map((pty) => ({ ...pty.info, exit: pty.exit }));
  }

  /** Open a terminal of a kind in a project folder, or open a terminal that exists again (`terminal`). */
  open(request: {
    kind: unknown;
    project: string;
    cwd: string;
    cols: unknown;
    rows: unknown;
    terminal?: unknown;
  }): TerminalOpened {
    const at = size(request.cols, request.rows);
    const known = typeof request.terminal === "string" ? this.#ptys.get(request.terminal) : undefined;
    if (known !== undefined)
      return { ...known.info, exit: known.exit, attached: true, replay: known.attach(at.cols, at.rows) };
    if (request.kind !== "claude" && request.kind !== "shell") {
      throw new Error('The parameter "kind" is "claude" or "shell".');
    }
    const kind: TerminalKind = request.kind;
    if (kind === "shell" && this.options.refuseShell === true) throw new Error("This studio gives no shell.");
    const env = terminalEnv(this.options.env ?? process.env);
    const cmd = this.options.program?.(kind, request.cwd, request.project) ?? defaultProgram(kind, env);
    const info: Omit<TerminalInfo, "exit"> = {
      terminal: `t${String(this.#next++)}`,
      kind,
      project: request.project,
      cwd: request.cwd,
    };
    const { options } = this;
    const pty = new Pty(
      info,
      cmd,
      env,
      at,
      { emit: (event) => options.emit(event), batchMs: options.batchMs ?? 12 },
      this.options.scrollbackChars ?? 2 * 1024 * 1024,
    );
    this.#ptys.set(info.terminal, pty);
    return { ...info, exit: null, attached: false, replay: "" };
  }

  input(id: string, data: unknown): void {
    if (typeof data !== "string") throw new Error('The parameter "data" must be a text.');
    this.#get(id).write(data);
  }

  resize(id: string, cols: unknown, rows: unknown): void {
    const at = size(cols, rows);
    this.#get(id).resize(at.cols, at.rows);
  }

  async close(id: string): Promise<void> {
    await this.#get(id).close(this.options.killAfterMs ?? 2000);
    this.#ptys.delete(id);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#ptys.keys()].map((id) => this.close(id)));
  }

  #get(id: string): Pty {
    const pty = this.#ptys.get(id);
    if (pty === undefined) throw new Error(`No terminal ${id}.`);
    return pty;
  }
}

/**
 * The program of the kind `claude` with the MCP server of the studio (`scenity mcp` of this host) for the project:
 * the config goes to a file of the studio state folder, and the CLI starts with `--mcp-config <file>`.
 */
export function claudeWithStudio(
  stateDir: string,
  mcpEntry: string,
): (kind: TerminalKind, cwd: string, project: string) => readonly string[] {
  return (kind, _cwd, project) => {
    const env = terminalEnv(process.env);
    const program = defaultProgram(kind, env);
    if (kind === "shell") return program;
    const file = join(stateDir, `terminal-mcp-${project}.json`);
    const args = [mcpEntry, "--name", "Claude Code (terminal)", "--project", project, "--state", stateDir];
    writeFileSync(file, JSON.stringify({ mcpServers: { scenity: { command: process.execPath, args } } }));
    return [...program, "--mcp-config", file];
  };
}

function reply(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/**
 * The API of the terminals: `GET /api/terminals`;
 * `POST /api/terminals` with `{ kind, project, cols, rows, terminal? }`;
 * `POST /api/terminals/<id>/input` with `{ data }`; `POST /api/terminals/<id>/resize` with `{ cols, rows }`;
 * `DELETE /api/terminals/<id>`.
 */
export async function terminalApi(
  terminals: Terminals,
  request: Request,
  url: URL,
  dirOf: (project: string) => string | null,
): Promise<Response> {
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const [, id, action] = /^\/api\/terminals(?:\/([\w-]+))?(?:\/(input|resize))?$/.exec(url.pathname) ?? [];
  try {
    if (id === undefined && request.method === "GET") return reply({ terminals: terminals.list() });
    if (id === undefined && request.method === "POST") {
      const project = typeof body.project === "string" ? body.project : "";
      const cwd = dirOf(project);
      if (cwd === null) return reply({ error: `no project ${project}` }, 404);
      return reply(terminals.open({ ...body, kind: body.kind, project, cwd, cols: body.cols, rows: body.rows }));
    }
    if (id !== undefined && action === "input") terminals.input(id, body.data);
    else if (id !== undefined && action === "resize") terminals.resize(id, body.cols, body.rows);
    else if (id !== undefined && request.method === "DELETE") await terminals.close(id);
    else return reply({ error: "no such path" }, 404);
    return reply({ ok: true });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 422);
  }
}
