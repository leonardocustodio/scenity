// SPDX-License-Identifier: Apache-2.0
/**
 * The windows of other checkouts. One host serves one window: its open checkout,
 * its dev servers, its terminals and its Claude sessions. "Open in a new window" in a browser asks this host to start
 * a second host for the other checkout (`bun src/main.ts --checkout <path> --port 0`); its state folder is the one of
 * that checkout, so the sessions stay apart. The page opens a new tab on the endpoint of the second host. The labs
 * app does the same with its own command `open_window`. The GPU stays shared: the lab tools
 * take the GPU lock themselves.
 */
import { spawn } from "node:child_process";
import { hostCommand, hostSourceFile } from "./hostRuntime";
import { parseReadyLine, type HostEndpoint } from "./protocol";
import { childEnv } from "./servers";

/** The main script of the host. */
// The source file also for a compiled host. A compiled host starts its own binary (hostCommand).
export const MAIN_SCRIPT = hostSourceFile("main.ts");

/** A started host of another checkout. */
export interface WindowHost {
  readonly endpoint: HostEndpoint;
  /** True while the process runs. */
  alive(): boolean;
  stop(): void;
}

/** Start a host process for a checkout and wait for its READY line (a test gives a fake). */
export type HostStarter = (checkout: string, timeoutMs: number) => Promise<WindowHost>;

/** The default starter: a child process of this host; it ends with this host (SIGTERM at the stop). */
export const startHostProcess: HostStarter = (checkout, timeoutMs) =>
  new Promise((resolve, reject) => {
    const [program = process.execPath, ...programArgs] = hostCommand(MAIN_SCRIPT);
    const child = spawn(program, [...programArgs, "--checkout", checkout, "--port", "0"], {
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let alive = true;
    let text = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The second host gave no READY line in time."));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      text += part;
      const endpoint = text
        .split("\n")
        .map(parseReadyLine)
        .find((value) => value !== null);
      if (endpoint === undefined) return;
      clearTimeout(timer);
      resolve({ endpoint, alive: () => alive, stop: () => child.kill("SIGTERM") });
    });
    child.stderr.resume();
    child.on("exit", (code) => {
      alive = false;
      clearTimeout(timer);
      reject(new Error(`The second host ended (exit ${String(code)}).`));
    });
  });

export interface WindowsOptions {
  /** The checkout of this host: it has its window already. */
  current(): string;
  /** True when the path is a worktree of the repository. */
  isCheckout(path: string): Promise<boolean>;
  readonly start?: HostStarter;
  readonly timeoutMs?: number;
}

/** The second hosts of one host, one per checkout. */
export class WindowHosts {
  readonly #options: WindowsOptions;
  readonly #hosts = new Map<string, WindowHost>();

  constructor(options: WindowsOptions) {
    this.#options = options;
  }

  /** The endpoint of the host of a checkout: a running one, or a new one. */
  async open(path: string): Promise<{ origin: string; token: string; checkout: string }> {
    if (!path.startsWith("/")) throw new Error("The checkout path must be absolute.");
    if (!(await this.#options.isCheckout(path)))
      throw new Error(`The path is not a worktree of the repository: ${path}`);
    if (path === this.#options.current()) throw new Error("This window shows that checkout already.");
    let host = this.#hosts.get(path);
    if (!host?.alive()) {
      host = await (this.#options.start ?? startHostProcess)(path, this.#options.timeoutMs ?? 30_000);
      this.#hosts.set(path, host);
    }
    return { ...host.endpoint, checkout: path };
  }

  /** Stop every second host. */
  stopAll(): void {
    for (const host of this.#hosts.values()) host.stop();
    this.#hosts.clear();
  }
}
