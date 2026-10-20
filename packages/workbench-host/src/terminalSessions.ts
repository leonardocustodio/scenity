// SPDX-License-Identifier: Apache-2.0
/**
 * The sessions of the Claude terminals: the host keeps
 * the session ID of each `claude` terminal, so the Claude tab can offer "Resume" and "Export transcript".
 *
 * The host learns an ID three ways:
 *
 * - `launch`: a new terminal starts the CLI with `--session-id <uuid>` (terminal.ts), so the ID is known immediately;
 * - `hook`: the `SessionStart` hook of the interactive CLI (`-p` does not fire it) gives `session_id`, with the
 *   terminal in the `x-workbench-terminal` header (settings.ts). A `/clear` or a resume gives a new ID this way;
 * - `folder`: the fallback for a terminal without an ID: the newest transcript of the CLI for the checkout
 *   (`~/.claude/projects/<cwd key>/<id>.jsonl`) made after the terminal start.
 *
 * The records go to `<state>/terminal-sessions.json` (at most 50).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalSessionInfo } from "./protocol";
import { needString, type Router } from "./router";
import { readJsonObject, writeJsonAtomic } from "./state";
import type { ClaudeTerminalInfo } from "./terminal";
import { exportTranscript } from "./transcript";

const FILE = "terminal-sessions.json";
const MAX_RECORDS = 50;
/** A session ID of the CLI (a UUID). */
export const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The time before the terminal start that the folder fallback accepts (the clocks of the file system, ms). */
const FOLDER_SLACK_MS = 2_000;

export type SessionSource = TerminalSessionInfo["source"];
type StoredSession = Omit<TerminalSessionInfo, "live" | "transcript">;

/** The folder name of the transcripts of a working folder: each character that is not a letter or a digit is `-`. */
export function projectKey(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** The folder of the transcripts of a working folder (`CLAUDE_CONFIG_DIR` or `~/.claude`). */
export function transcriptFolder(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "projects", projectKey(cwd));
}

export interface TerminalSessionsOptions {
  readonly stateDir: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
  readonly now?: () => Date;
}

/** The recorded sessions of the Claude terminals of a host. */
export class TerminalSessions {
  readonly #file: string;
  readonly #options: TerminalSessionsOptions;

  constructor(options: TerminalSessionsOptions) {
    this.#options = options;
    this.#file = join(options.stateDir, FILE);
  }

  #read(): StoredSession[] {
    const list = readJsonObject(this.#file).sessions;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is StoredSession =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StoredSession).session === "string" &&
        typeof (item as StoredSession).terminal === "string" &&
        typeof (item as StoredSession).checkout === "string",
    );
  }

  /** The transcript file of a session of a checkout. */
  transcript(checkout: string, session: string): string {
    return join(transcriptFolder(checkout, this.#options.env, this.#options.home), `${session}.jsonl`);
  }

  /** Record the session of a terminal. A known session gets the new time and source; an ID that is not a UUID is ignored. */
  record(entry: { session: string; terminal: string; checkout: string; source: SessionSource }): void {
    if (!SESSION_PATTERN.test(entry.session)) return;
    const now = (this.#options.now?.() ?? new Date()).toISOString();
    const all = this.#read();
    const old = all.find((item) => item.session === entry.session);
    const next: StoredSession = { ...entry, started: old?.started ?? now, seen: now };
    const rest = all.filter((item) => item.session !== entry.session);
    writeJsonAtomic(this.#file, { sessions: [next, ...rest].slice(0, MAX_RECORDS) });
  }

  /** The newest session of a terminal, or null. */
  ofTerminal(terminal: string): string | null {
    return this.#read().find((item) => item.terminal === terminal)?.session ?? null;
  }

  /** The sessions of a checkout, the newest first. `live` names the terminals that run. */
  list(checkout: string, live: ReadonlySet<string> = new Set()): TerminalSessionInfo[] {
    return this.#read()
      .filter((item) => item.checkout === checkout)
      .sort((a, b) => b.seen.localeCompare(a.seen))
      .map((item) => ({
        ...item,
        live: live.has(item.terminal),
        transcript: existsSync(this.transcript(checkout, item.session)),
      }));
  }

  /**
   * The folder fallback: the newest transcript of the checkout that the CLI made after `startedMs` and that no record
   * has. A transcript that names the origin of this host comes first (its hooks called it).
   */
  findInFolder(checkout: string, startedMs: number, origin: string | null): string | null {
    const folder = transcriptFolder(checkout, this.#options.env, this.#options.home);
    if (!existsSync(folder)) return null;
    const known = new Set(this.#read().map((item) => item.session));
    const candidates = readdirSync(folder)
      .filter((name) => name.endsWith(".jsonl") && SESSION_PATTERN.test(name.slice(0, -6)))
      .map((name) => ({ session: name.slice(0, -6), stat: statSync(join(folder, name)) }))
      .filter(({ session, stat }) => !known.has(session) && stat.birthtimeMs >= startedMs - FOLDER_SLACK_MS)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const named = origin === null ? undefined : candidates.find(({ session }) => mentions(folder, session, origin));
    return (named ?? candidates[0])?.session ?? null;
  }
}

/** True when the first 4 MB of a transcript contain the text. */
function mentions(folder: string, session: string, text: string): boolean {
  try {
    return readFileSync(join(folder, `${session}.jsonl`))
      .subarray(0, 4 * 1024 * 1024)
      .includes(text);
  } catch {
    return false;
  }
}

/** What the session requests need from the host. */
export interface SessionRouteDeps {
  readonly sessions: TerminalSessions;
  /** The `claude` terminals of the host (terminal.ts `claudeTerminals`). */
  claudeTerminals(): readonly ClaudeTerminalInfo[];
  /** The open checkout. */
  current(): string;
  /** The origin of the host (the folder fallback finds it in a transcript). */
  readonly origin: string | null;
}

/** The folder fallback: give each `claude` terminal of the checkout without a record the newest new transcript. */
export function fillFromFolder(deps: SessionRouteDeps, checkout: string): void {
  for (const terminal of deps.claudeTerminals()) {
    if (terminal.checkout !== checkout || deps.sessions.ofTerminal(terminal.id) !== null) continue;
    const session = deps.sessions.findInFolder(checkout, terminal.startedMs, deps.origin);
    if (session !== null) deps.sessions.record({ session, terminal: terminal.id, checkout, source: "folder" });
  }
}

/** Add the requests `terminal.sessions` and `terminal.export`. */
export function addSessionHandlers(router: Router, deps: SessionRouteDeps): void {
  router
    .on("terminal.sessions", () => {
      const checkout = deps.current();
      fillFromFolder(deps, checkout);
      const live = new Set(
        deps
          .claudeTerminals()
          .filter((item) => item.live)
          .map((item) => item.id),
      );
      return { sessions: deps.sessions.list(checkout, live) };
    })
    .on("terminal.export", (params) => {
      const session = needString(params, "session");
      if (!SESSION_PATTERN.test(session)) throw new Error('The parameter "session" must be a session ID.');
      const checkout = deps.current();
      const file = deps.sessions.transcript(checkout, session);
      return exportTranscript({ checkout, session, folder: needString(params, "folder"), file });
    });
}
