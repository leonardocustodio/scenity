// SPDX-License-Identifier: Apache-2.0
/**
 * The processes of the workbench end-to-end tests and of the performance run: the host in test mode on this checkout
 * (its lab dev server starts with it) and the Vite server of the workbench page.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseReadyLine, type HostEndpoint } from "@scenity/workbench-host/protocol";
import { CHECKOUT_ENV } from "./env";

/**
 * The folders: apps/workbench, the Bun workspace and the checkout. The workspace is the repo root. The checkout is the
 * folder of `CHECKOUT_ENV` when the variable is set (env.ts).
 */
export const PAGE_DIR = resolve(import.meta.dirname, "..", "..");
export const WEB_DIR = resolve(PAGE_DIR, "..", "..");
export const CHECKOUT = resolve(process.env[CHECKOUT_ENV] ?? WEB_DIR);
const TEST_HOST = join(WEB_DIR, "packages", "workbench-host", "tests", "e2e-host", "main.ts");

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        done(port);
      });
    });
  });
}

export interface TestHostOptions {
  readonly state: string;
  /** The saved query of the lab surface URL. */
  readonly labQuery: string;
  /** The program of the terminals (default /bin/sh). */
  readonly shell?: string;
  /** The checkout or project folder of the host (default: this checkout). */
  readonly checkout?: string;
}

/** Start the host in test mode and read its READY line. The child goes into `children`. */
export function startTestHost(
  options: TestHostOptions,
  children: ChildProcess[],
): Promise<{ endpoint: HostEndpoint; pid: number }> {
  const checkout = options.checkout ?? CHECKOUT;
  const args = [TEST_HOST, "--checkout", checkout, "--state", options.state, "--lab-url", options.labQuery];
  if (options.shell !== undefined) args.push("--shell", options.shell);
  const child = spawn("bun", args, { cwd: WEB_DIR, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      fail(new Error("The test host gave no READY line in 60 s."));
    }, 60_000);
    child.on("exit", (code) => {
      fail(new Error(`The test host stopped with code ${String(code)}.`));
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const endpoint = parseReadyLine(line);
      if (endpoint === null) return;
      clearTimeout(timer);
      done({ endpoint, pid: child.pid ?? 0 });
    });
  });
}

/** Start the Vite server of the workbench page and wait until it answers. The child goes into `children`. */
export async function startPageServer(children: ChildProcess[]): Promise<{ origin: string }> {
  const port = await freePort();
  const child = spawn("bunx", ["--bun", "vite", "--port", String(port), "--strictPort", "--logLevel", "warn"], {
    cwd: PAGE_DIR,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const origin = `http://127.0.0.1:${String(port)}`;
  const end = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(origin)).ok) return { origin };
    } catch {
      // The server does not listen yet.
    }
    if (Date.now() > end) throw new Error(`The workbench page server at ${origin} did not start in 60 s.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Stop a child with SIGTERM and wait at most 10 s for its exit. */
export function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.kill("SIGTERM");
  });
}
