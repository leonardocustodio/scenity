// SPDX-License-Identifier: Apache-2.0
/**
 * The child processes of the studio host: the last lines of an output, a free port,
 * the environment of a child, and a server child (the scene server) that runs in its own process group. A stop ends
 * the server and every child of it. The workbench host uses `LogRing` and `freePort` of this module too.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

/** The last lines of the output of a process. */
export class LogRing {
  readonly #max: number;
  readonly #lines: string[] = [];
  #partial = "";

  constructor(max = 400) {
    this.#max = max;
  }

  /** Add output text. A line without its line end waits for the next text. */
  push(text: string): void {
    const parts = (this.#partial + text).split(/\r?\n/);
    this.#partial = parts.pop() ?? "";
    for (const line of parts) this.#add(line);
  }

  /** Add one full line. */
  line(text: string): void {
    this.#add(text);
  }

  #add(line: string): void {
    this.#lines.push(line);
    if (this.#lines.length > this.#max) this.#lines.splice(0, this.#lines.length - this.#max);
  }

  /** The lines, the oldest first, with the open line at the end. */
  lines(): string[] {
    return this.#partial === "" ? [...this.#lines] : [...this.#lines, this.#partial];
  }

  /** The last `count` lines as one text. */
  tail(count: number): string {
    return this.lines().slice(-count).join("\n");
  }
}

/** A free TCP port of 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * The variables that a child of the studio never gets: the token and the supervisor switches of a workbench host, the
 * secret of a lab page, and the lab tools switch (it disables the file watch and HMR of apps/editor).
 */
const HOST_ONLY_ENV = [
  "SCENITY_WORKBENCH_TOKEN",
  "SCENITY_WORKBENCH_WORKER",
  "SCENITY_WORKBENCH_SUPERVISED",
  "SCENITY_LABS_PAGE_SECRET",
  "SCENITY_LAB_TOOLS",
];

/** The environment of a child: the host environment without the host-only variables, with `extra` on top. */
export function childEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !HOST_ONLY_ENV.includes(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

/** The program, the folder and the environment of a child. */
export interface ChildCommand {
  readonly cmd: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export type ServerState = "stopped" | "starting" | "ready" | "failed";

/** A snapshot of a server child. */
export interface ServerInfo {
  readonly status: ServerState;
  readonly port: number | null;
  readonly origin: string | null;
  readonly error: string | null;
}

export interface ServerOptions {
  /** The command of the server on a port. */
  readonly command: (port: number) => ChildCommand;
  /** The path that answers 200 when the server is ready. */
  readonly readyPath: string;
  /** A fixed port in place of a free port. */
  readonly port?: number;
  readonly readyTimeoutMs?: number;
}

const STOP_GRACE_MS = 3000;

/** Send a signal to the process group of a child. Ignore a group that ended. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group ended already.
  }
}

/** One server child of the studio host. */
export class ServerChild {
  readonly log = new LogRing();
  readonly #options: ServerOptions;
  #status: ServerState = "stopped";
  #port: number | null = null;
  #error: string | null = null;
  #child: ChildProcess | null = null;
  #starting: Promise<void> | null = null;

  constructor(options: ServerOptions) {
    this.#options = options;
  }

  get info(): ServerInfo {
    const origin = this.#port === null ? null : `http://127.0.0.1:${String(this.#port)}`;
    return { status: this.#status, port: this.#port, origin, error: this.#error };
  }

  /** Start the server. The promise resolves when the server is ready or failed. */
  start(): Promise<void> {
    if (this.#status === "ready") return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    const port = this.#options.port ?? (await freePort());
    this.#port = port;
    this.#set("starting");
    const command = this.#options.command(port);
    const [program, ...args] = command.cmd;
    const child = spawn(program, args, { cwd: command.cwd, env: command.env, detached: true, stdio: "pipe" });
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.log.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => this.log.push(chunk.toString("utf8")));
    child.once("error", (error) => this.#ended(child, error.message));
    child.once("exit", (code, signal) =>
      this.#ended(child, `the server ended with ${signal ?? `code ${String(code)}`}`),
    );
    const ready = await this.#waitReady(child, `http://127.0.0.1:${String(port)}${this.#options.readyPath}`);
    if (this.#child !== child) return;
    if (ready === true) this.#set("ready");
    else {
      this.#set("failed", ready);
      await this.#kill(child);
    }
  }

  #ended(child: ChildProcess, reason: string): void {
    if (this.#child !== child) return;
    this.#child = null;
    if (this.#status !== "stopped") this.#set("failed", `${reason}. ${this.log.tail(1)}`.trim());
  }

  #set(status: ServerState, error: string | null = null): void {
    this.#status = status;
    this.#error = error;
    this.log.line(`[studio] ${status}${error === null ? "" : `: ${error}`}`);
  }

  /** Poll the URL. Give true when it answers 200, or the error text. */
  async #waitReady(child: ChildProcess, url: string): Promise<true | string> {
    const timeout = this.#options.readyTimeoutMs ?? 90_000;
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (this.#child !== child) return this.#error ?? "The server ended.";
      const ok = await fetch(url).then(
        (answer) => answer.ok,
        () => false,
      );
      if (ok) return true;
      await Bun.sleep(250);
    }
    return `The server did not answer at ${url} in ${String(timeout)} ms.`;
  }

  async #kill(child: ChildProcess): Promise<void> {
    if (this.#child === child) this.#child = null;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    signalGroup(child, "SIGTERM");
    const timer = setTimeout(() => signalGroup(child, "SIGKILL"), STOP_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }

  /** Stop the server and every process of its group. */
  async stop(): Promise<void> {
    const child = this.#child;
    this.#port = null;
    this.#set("stopped");
    if (child !== null) await this.#kill(child);
  }
}
