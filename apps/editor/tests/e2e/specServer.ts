// SPDX-License-Identifier: Apache-2.0
// The server of a scene page spec: the studio host with its one scene server. Thus each spec runs on the path of the
// studio (the proxy of the host, the projects file of the open projects, the session cookie of a launch link). The spec
// opens its project folders through the API of the host. The key of a project in a page URL is the project ID (a second
// project with the same ID gets `-2`). A project that runs code gets the trust of the owner, so its plugins load as in
// a spec on the scene server alone.
//
// `SCENITY_E2E_SERVER=scene` starts the scene server alone (`SCENITY_SCENE_PROJECTS`, the path of `scenity dev`), with
// the names of the spec as the keys. Use it to find if a failure comes from the studio path.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const REPO = join(LABS_ROOT, "..", "..");
/** The files of the user state of the host that a test starts without (packages/studio-host `userState.ts`). */
const USER_STATE_FILES = ["preferences.json", "layouts.json", "keymap.json"];

export interface SpecServer {
  readonly origin: string;
  /** The key of each project of the spec in the page URLs, by the name that the spec gives it. */
  readonly keys: Readonly<Record<string, string>>;
  /**
   * Put the session cookies of the studio into a browser context (nothing on the scene server alone). The user state
   * of the host (the preferences, the layouts, the key map) returns to its defaults first, as the browser storage
   * of a new context: a test does not see the layout of the test before it.
   */
  signIn(context: BrowserContext): Promise<void>;
  /** A request of a tool: with the token of the host on the studio path. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
}

/** True when the specs run on the studio path (the default), false on the scene server alone. */
export const ON_STUDIO = process.env.SCENITY_E2E_SERVER !== "scene";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** The first stdout line of a child that starts with `prefix`, without the prefix. */
async function readyLine(child: ReturnType<typeof Bun.spawn>, prefix: string): Promise<string> {
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the studio ended: ${text}`);
    text += new TextDecoder().decode(value);
    const line = text.split("\n").find((item) => item.startsWith(prefix));
    if (line !== undefined) {
      // The rest of the output continues to the log of the spec.
      void (async () => {
        for (;;) {
          const next = await reader.read().catch(() => null);
          if (next === null || next.done) return;
          process.stdout.write(next.value);
        }
      })();
      return line.slice(prefix.length + 1);
    }
  }
}

/** The scene server alone on a free port, with the projects of the spec in `SCENITY_SCENE_PROJECTS`. */
async function sceneServer(
  projects: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): Promise<SpecServer> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const list = Object.entries(projects).map(([name, dir]) => `${name}=${dir}`);
  const server = Bun.spawn(
    ["bunx", "--bun", "vite", "--config", "vite.scene.config.ts", "--port", String(port), "--strictPort"],
    {
      cwd: LABS_ROOT,
      env: { ...process.env, SCENITY_SCENE_PROJECTS: list.join(","), SCENITY_SCENE_NO_WATCH: "1", ...env },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  for (let wait = 0; wait < 240; wait += 1) {
    const up = await fetch(`${origin}/scene.html`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) {
      return {
        origin,
        keys: Object.fromEntries(Object.keys(projects).map((name) => [name, name])),
        signIn: () => Promise.resolve(),
        fetch: (path, init) => fetch(`${origin}${path}`, init),
        stop: async () => {
          server.kill();
          await server.exited;
        },
      };
    }
    await Bun.sleep(500);
  }
  server.kill();
  throw new Error(`the scene server at ${origin} did not start`);
}

/** The name and the value of each cookie of `Set-Cookie` headers. */
function cookiesOf(headers: Headers): { name: string; value: string; httpOnly: boolean }[] {
  return headers.getSetCookie().map((line) => {
    const [pair = "", ...flags] = line.split(";");
    const at = pair.indexOf("=");
    const httpOnly = flags.some((flag) => flag.trim().toLowerCase() === "httponly");
    return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), httpOnly };
  });
}

/** The studio host with its scene server, and the projects of the spec open in it. */
async function studioServer(
  projects: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): Promise<SpecServer> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const state = mkdtempSync(join(tmpdir(), "scenity-spec-studio-"));
  const host = Bun.spawn(
    [
      "bun",
      join(REPO, "packages", "studio-host", "src", "main.ts"),
      "--port",
      String(port),
      "--state",
      state,
      "--no-open",
    ],
    { cwd: REPO, env: { ...process.env, SCENITY_SCENE_NO_WATCH: "1", ...env }, stdout: "pipe", stderr: "inherit" },
  );
  const stop = async (): Promise<void> => {
    host.kill("SIGTERM");
    await host.exited;
    rmSync(state, { recursive: true, force: true });
  };
  try {
    await readyLine(host, "SCENITY_STUDIO_READY");
    const secret = (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
    const tool = (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set("x-studio-token", secret);
      return fetch(`${origin}${path}`, { ...init, headers });
    };
    const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const answer = await tool(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!answer.ok) throw new Error(`${path}: ${String(answer.status)} ${await answer.text()}`);
      return (await answer.json()) as Record<string, unknown>;
    };
    const keys: Record<string, string> = {};
    for (const [name, dir] of Object.entries(projects)) {
      const opened = await post("/api/projects/open", { dir });
      keys[name] = String(opened.key);
      if (opened.restricted === true) await post("/api/projects/trust", { key: opened.key });
    }
    const signIn = async (context: BrowserContext): Promise<void> => {
      for (const file of USER_STATE_FILES) rmSync(join(state, file), { force: true });
      const { url } = (await post("/api/launch-code", {})) as { url: string };
      const answer = await fetch(new URL(url, origin), { redirect: "manual" });
      const cookies = cookiesOf(answer.headers).map((cookie) => ({
        ...cookie,
        url: origin,
        sameSite: "Strict" as const,
      }));
      if (cookies.length === 0) throw new Error("the launch link gave no session cookie");
      await context.addCookies(cookies);
    };
    return { origin, keys, signIn, fetch: tool, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Start the server of a spec with its projects (`name` → folder) and more environment of the scene server. The
 * default is the studio path; `SCENITY_E2E_SERVER=scene` gives the scene server alone.
 */
export function startSpecServer(
  projects: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>> = {},
): Promise<SpecServer> {
  return ON_STUDIO ? studioServer(projects, env) : sceneServer(projects, env);
}
