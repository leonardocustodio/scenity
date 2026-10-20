// SPDX-License-Identifier: Apache-2.0
/**
 * The dev server of the 3D room lab tools: a running server (`--url`), or a Vite dev server of this checkout on a free
 * port. A free port lets several agents in several worktrees run the tools at the same time.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { LAB_KEY_ENV, LAB_KEY_HEADER, newLabKey } from "@scenity/labs-platform/labKey";
import { envValue } from "@scenity/labs-platform/envNames";

/** The app folder (apps/editor) of this checkout. */
export const APP = fileURLToPath(new URL("../..", import.meta.url));

/** The path of the lab page: the root of the editor app. */
export const LAB_PATH = "/";

/**
 * The per-process secrets of the dev servers of this process, by origin. A page of the tools sends the secret of its
 * server (`labPageHeaders`) and passes the page key gate of the lab page.
 */
const LAB_KEYS = new Map<string, string>();

/** The environment of a new dev server: a new per-process secret, kept for its origin. */
export function labServerEnv(origin: string): Record<string, string> {
  const key = newLabKey();
  LAB_KEYS.set(origin, key);
  return { [LAB_KEY_ENV]: key };
}

/** Keep the secret of a server of this process that has its own secret (the built lab of the render pool). */
export function rememberLabKey(origin: string, key: string): void {
  LAB_KEYS.set(origin.replace(/\/$/, ""), key);
}

/** The headers of a Playwright page of a dev server of this process (`extraHTTPHeaders`). None for another server. */
export function labPageHeaders(origin: string): Record<string, string> {
  const key = LAB_KEYS.get(origin.replace(/\/$/, ""));
  return key === undefined ? {} : { [LAB_KEY_HEADER]: key };
}

export interface LabServer {
  readonly origin: string;
  stop(): void;
}

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

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`The dev server at ${url} did not start in ${String(timeoutMs / 1000)} s.`);
}

/** The server of `url`, or a new Vite dev server of this checkout on a free port. */
export async function labServer(url: string | undefined): Promise<LabServer> {
  if (url !== undefined) {
    const given = url.replace(/\/$/, "");
    // A person started this server with a secret. The same secret here lets the pages pass the page key gate.
    const key = envValue(LAB_KEY_ENV);
    if (key !== undefined && key !== "") LAB_KEYS.set(given, key);
    return { origin: given, stop: () => undefined };
  }
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const child: ChildProcess = spawn(
    "bunx",
    ["--bun", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    // SCENITY_LAB_TOOLS: the server does not watch the files (vite.config.ts), so an edit does not reload the page.
    // The per-process secret lets the pages of the tools pass the page key gate of the lab page.
    { cwd: APP, stdio: "ignore", env: { ...process.env, SCENITY_LAB_TOOLS: "1", ...labServerEnv(origin) } },
  );
  try {
    await waitFor(`${origin}${LAB_PATH}`, 90_000);
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    origin,
    stop: () => {
      child.kill();
    },
  };
}
