// SPDX-License-Identifier: Apache-2.0
/**
 * The dev servers of the surfaces: a Vite server of apps/editor per checkout, on a free port, with file watch and
 * HMR enabled. The logic of the start comes from apps/editor/scripts/lab/server.ts. The host does not import
 * apps/editor, so it has its own copy. Each server runs in its own process group, so a stop ends Vite and every
 * child of it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { LAB_KEY_ENV, newLabKey } from "@scenity/labs-platform/labKey";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ServerStatus } from "./protocol";
import { childGroups } from "./children";
import { bunPath, hostSourceDir } from "./hostRuntime";
import { SUPERVISED_ENV, WORKER_ENV } from "./supervisorEnv";
import { TOKEN_ENV } from "./protocol";
import { defaultProjectDir } from "./plugins";
import { PROJECT_FILE } from "@scenity/scene";
import { freePort, LogRing } from "@scenity/studio-host/process";

/** The program, the folder and the environment of a dev server. */
export interface ServerCommand {
  readonly cmd: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Make the command of a dev server of a checkout on a port. */
export type CommandFactory = (checkout: string, port: number) => ServerCommand;

/** The folder of the labs app in a checkout. */
export const LAB_APP = join("apps", "editor");
/** The kind of the editor dev server (the Vite of apps/editor). It serves the surfaces of the kind `scene`. */
export const EDITOR_SERVER = "editor";

/**
 * The folder whose labs app runs the scene surface of a checkout: the checkout when it has the labs app (this
 * repository), else the Scenity repository of the host source (a copy of a sample, or the workspace of another
 * repository that links the Scenity packages).
 */
export function labRoot(checkout: string): string {
  if (existsSync(join(checkout, LAB_APP))) return checkout;
  return resolve(hostSourceDir(), "..", "..", "..");
}

/**
 * The project of the labs app of the host source for a checkout with no labs app: the variable
 * `SCENITY_PROJECT` with the project folder of the checkout. Empty when the checkout has its labs app, when the
 * variable is set, or when the checkout names no project.
 */
export function labProjectEnv(
  checkout: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  if (labRoot(checkout) === checkout || (env.SCENITY_PROJECT ?? "") !== "") return {};
  const project = existsSync(join(checkout, PROJECT_FILE)) ? checkout : defaultProjectDir(checkout, env);
  return project === null ? {} : { SCENITY_PROJECT: project };
}

/** The environment of a child: the host environment without the launch token and without the lab tools switch. */
export function childEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  // SCENITY_LAB_TOOLS=1 disables the file watch and HMR (apps/editor/vite.config.ts). The workbench wants HMR.
  // The switches of the supervisor (supervisor.ts) stay with the host. A second host has its own.
  // The per-process secret of a lab server is its own. A child never inherits one.
  const removed = new Set([TOKEN_ENV, "SCENITY_LAB_TOOLS", WORKER_ENV, SUPERVISED_ENV, LAB_KEY_ENV]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !removed.has(key)) env[key] = value;
  return { ...env, ...extra };
}

/** The Vite server of apps/editor of the checkout, on 127.0.0.1 and the given port, with HMR enabled. */
export function labCommand(checkout: string, port: number): ServerCommand {
  return {
    cmd: [bunPath(), "x", "--bun", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    cwd: join(labRoot(checkout), LAB_APP),
    // A new per-process secret: the frames of the workbench skip the sign-in of the lab page (surfaces.ts).
    env: childEnv({ ...labProjectEnv(checkout), [LAB_KEY_ENV]: newLabKey() }),
  };
}

// The last lines of an output and a free port: one copy in the studio host (packages/studio-host/src/process.ts).
export { freePort, LogRing };

export interface DevServerOptions {
  readonly checkout: string;
  /** The kind of the server (`EDITOR_SERVER`); the process list names the server with it. */
  readonly kind: string;
  readonly command: CommandFactory;
  /** The path that answers 200 when the server is ready. */
  readonly readyPath?: string;
  readonly readyTimeoutMs?: number;
  readonly pollMs?: number;
  /**
   * The automatic restarts after a crash of a ready server, until the next start by the owner (default 1), and
   * the wait before each (ms; default 1500, twice as long for the second). During the wait, the page shows the
   * failed state.
   */
  readonly autoRestarts?: number;
  readonly backoffMs?: number;
  /** A fixed port in place of a free port (the remote mode, remote.ts). */
  readonly fixedPort?: number;
  /** The origin and path of the frames in place of `http://127.0.0.1:<port>` (the remote mode, remote.ts). */
  readonly frameOrigin?: string;
}

/** A snapshot of a dev server. */
export interface DevServerInfo {
  readonly status: ServerStatus;
  readonly port: number | null;
  readonly origin: string | null;
  /** The origin of the frames: the public origin and base path in the remote mode, else `origin`. */
  readonly frameOrigin: string | null;
  readonly error: string | null;
}

const STOP_GRACE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send a signal to the process group of a child. Ignore a group that ended. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group ended already.
  }
}

/** One dev server of a checkout. */
export class DevServer {
  readonly checkout: string;
  readonly kind: string;
  readonly log = new LogRing();
  readonly #options: DevServerOptions;
  readonly #listeners = new Set<(info: DevServerInfo) => void>();
  #status: ServerStatus = "stopped";
  #port: number | null = null;
  #error: string | null = null;
  #child: ChildProcess | null = null;
  #exited: Promise<void> = Promise.resolve();
  #starting: Promise<void> | null = null;
  /** A stop increments it, so a start that began before the stop does not spawn. */
  #generation = 0;
  /** The automatic restarts since the last start by the owner. */
  #crashes = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #pageKey: string | null = null;

  constructor(options: DevServerOptions) {
    this.checkout = options.checkout;
    this.kind = options.kind;
    this.#options = options;
  }

  get info(): DevServerInfo {
    const origin = this.#port === null ? null : `http://127.0.0.1:${String(this.#port)}`;
    const frameOrigin = origin === null ? null : (this.#options.frameOrigin ?? origin);
    return { status: this.#status, port: this.#port, origin, frameOrigin, error: this.#error };
  }

  /** The per-process secret of the lab page of the running server (its `SCENITY_LABS_PAGE_SECRET`), or null. */
  get pageKey(): string | null {
    return this.#pageKey;
  }

  /** The process ID of the server (the ID of its process group), or null. */
  get pid(): number | null {
    return this.#child?.pid ?? null;
  }

  /** Call the listener on each change of the state. Give the function that removes it. */
  onChange(listener: (info: DevServerInfo) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(status: ServerStatus, error: string | null = null): void {
    this.#status = status;
    this.#error = error;
    this.log.line(`[workbench] ${status}${error === null ? "" : `: ${error}`}`);
    const info = this.info;
    for (const listener of this.#listeners) listener(info);
  }

  /** Start the server. The promise resolves when the server is ready or failed. A running server stays as it is. */
  start(): Promise<void> {
    this.#crashes = 0;
    return this.#begin();
  }

  #begin(): Promise<void> {
    this.#clearRetry();
    if (this.#starting !== null) return this.#starting;
    if (this.#status === "ready") return Promise.resolve();
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    const generation = this.#generation;
    const port = this.#options.fixedPort ?? (await freePort());
    if (generation !== this.#generation) return;
    this.#port = port;
    this.#set("starting");
    const command = this.#options.command(this.checkout, port);
    const child = this.#spawn(command);
    const ready = await this.#waitReady(child, `http://127.0.0.1:${String(port)}${this.#options.readyPath ?? "/"}`);
    if (this.#child !== child) return;
    if (ready === true) this.#set("ready");
    else {
      this.#set("failed", ready);
      await this.#kill(child);
    }
  }

  #spawn(command: ServerCommand): ChildProcess {
    const [program, ...args] = command.cmd;
    this.#pageKey = command.env[LAB_KEY_ENV] ?? null;
    const child = spawn(program, args, {
      cwd: command.cwd,
      env: command.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    // The group goes into children.json, so a host that ends without its stop leaves no Vite behind.
    childGroups.add(child.pid, `${this.kind} dev server`, program);
    child.once("exit", () => childGroups.remove(child.pid));
    this.#exited = new Promise((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    child.stdout.on("data", (chunk: Buffer) => this.log.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => this.log.push(chunk.toString("utf8")));
    child.once("error", (error) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#set("failed", error.message);
    });
    child.once("exit", (code, signal) => this.#onExit(child, code, signal));
    return child;
  }

  #onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#child !== child) return;
    this.#child = null;
    if (this.#status === "stopped" || this.#status === "failed") return;
    const how = signal === null ? `code ${String(code)}` : `signal ${signal}`;
    const wasReady = this.#status === "ready";
    this.#set("failed", `The dev server ended with ${how}. ${this.log.tail(1)}`.trim());
    if (wasReady) this.#autoRestart();
  }

  /** Start a crashed server again after a wait, at most `autoRestarts` times until the owner starts it. */
  #autoRestart(): void {
    if (this.#crashes >= (this.#options.autoRestarts ?? 1)) return;
    this.#crashes += 1;
    const generation = this.#generation;
    const wait = (this.#options.backoffMs ?? 1_500) * this.#crashes;
    this.log.line(`[workbench] automatic restart ${String(this.#crashes)} in ${String(wait)} ms`);
    this.#retry = setTimeout(() => {
      this.#retry = null;
      if (generation === this.#generation && this.#status === "failed") void this.#begin();
    }, wait);
  }

  #clearRetry(): void {
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
  }

  /** Poll the URL. Give true when it answers 200, or the error text. */
  async #waitReady(child: ChildProcess, url: string): Promise<true | string> {
    const end = Date.now() + (this.#options.readyTimeoutMs ?? 90_000);
    while (Date.now() < end) {
      if (this.#child !== child) return this.#error ?? "The dev server ended.";
      try {
        const response = await fetch(url);
        if (response.ok) return true;
      } catch {
        // The server does not answer yet.
      }
      await sleep(this.#options.pollMs ?? 250);
    }
    return `The dev server did not answer at ${url} in ${String(this.#options.readyTimeoutMs ?? 90_000)} ms.`;
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
    const starting = this.#starting;
    this.#clearRetry();
    this.#generation += 1;
    this.#port = null;
    if (this.#status !== "stopped") this.#set("stopped");
    if (child !== null) await this.#kill(child);
    await this.#exited;
    // A start in progress sees the stop at its next poll and ends.
    if (starting !== null) await starting;
  }

  /** Stop the server and start it again on a new free port. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Send SIGTERM to the process group immediately, without a wait (the exit of the host). */
  killNow(): void {
    this.#clearRetry();
    if (this.#child !== null) signalGroup(this.#child, "SIGTERM");
  }
}

/** The dev servers of the host, one per checkout and server kind. */
export class DevServers {
  readonly #servers = new Map<string, DevServer>();
  readonly #make: (checkout: string, kind: string) => DevServer;

  constructor(make: (checkout: string, kind: string) => DevServer) {
    this.#make = make;
  }

  /** The server of a checkout and a kind. The first call makes it (stopped). */
  ensure(checkout: string, kind: string = EDITOR_SERVER): DevServer {
    const key = `${kind}\u0000${checkout}`;
    let server = this.#servers.get(key);
    if (server === undefined) {
      server = this.#make(checkout, kind);
      this.#servers.set(key, server);
    }
    return server;
  }

  all(): DevServer[] {
    return [...this.#servers.values()];
  }

  /** Stop every server. */
  async stopAll(): Promise<void> {
    await Promise.all(this.all().map((server) => server.stop()));
  }

  /** Send SIGTERM to every server immediately (the exit of the host). */
  killAllNow(): void {
    for (const server of this.all()) server.killNow();
  }
}
