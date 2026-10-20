// SPDX-License-Identifier: Apache-2.0
// The studio host: the launch link, the API with the session, the projects of a folder, the folders, the user state, a
// job of the real CLI, the proxy to a fake scene server with its WebSocket, and the refusals of foreign requests. Also
// a project saved as a template, and a project from that template.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "../src/access";
import { startStudio, type SceneServer, type Studio } from "../src/server";
import { freePort } from "../src/process";

const REPO = join(import.meta.dir, "..", "..", "..");
let root = "";
let studio: Studio;
let upstream: ReturnType<typeof Bun.serve>;
let cookie = "";
let csrf = "";

/** A fake scene server: it answers each path with its path, and echoes WebSocket text. */
function fakeScene(): SceneServer {
  upstream = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: undefined })) return undefined;
      const url = new URL(request.url);
      return new Response(`scene ${url.pathname}${url.search} cookie=${request.headers.get("cookie") ?? ""}`);
    },
    websocket: {
      message: (ws, message) => {
        ws.send(`echo ${String(message)}`);
      },
    },
  });
  const info: SceneServer["info"] = {
    status: "ready",
    port: upstream.port ?? null,
    origin: `http://127.0.0.1:${String(upstream.port)}`,
    error: null,
  };
  return { info, start: () => Promise.resolve(), stop: () => Promise.resolve() };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "studio-server-"));
  studio = await startStudio({
    port: await freePort(),
    stateDir: join(root, "state"),
    sceneServer: fakeScene,
    roots: [root],
  });
  const launch = await fetch(studio.launchUrl("/p/none"), { redirect: "manual" });
  expect(launch.status).toBe(303);
  expect(launch.headers.get("location")).toBe("/p/none");
  const set = launch.headers.getSetCookie();
  const value = (name: string): string =>
    set
      .find((c) => c.startsWith(`${name}=`))
      ?.split(";")[0]
      ?.split("=")[1] ?? "";
  csrf = value(CSRF_COOKIE);
  cookie = `${SESSION_COOKIE}=${value(SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;
});

afterAll(async () => {
  await studio.stop();
  void upstream.stop(true);
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string): Promise<Response> => fetch(`${studio.origin}${path}`, { headers: { cookie } });
const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${studio.origin}${path}`, {
    method: "POST",
    headers: { cookie, origin: studio.origin, [CSRF_HEADER]: csrf, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the studio host", () => {
  test("a launch code works once; a page with no session gets the locked page", async () => {
    const url = studio.launchUrl();
    expect((await fetch(url, { redirect: "manual" })).status).toBe(303);
    expect((await fetch(url, { redirect: "manual" })).status).toBe(401);
    const locked = await fetch(`${studio.origin}/scene.html`);
    expect(locked.status).toBe(401);
    expect(await locked.text()).toContain("scenity studio");
  });

  test("opens a project folder and gives its editor page", async () => {
    const dir = join(root, "spin");
    cpSync(join(REPO, "samples", "spin"), dir, { recursive: true, filter: (p) => !/\/(dist|node_modules)$/.test(p) });
    const opened = (await (await post("/api/projects/open", { dir })).json()) as {
      key: string;
      url: string;
      restricted: boolean;
    };
    expect(opened).toEqual({
      key: "spin",
      url: "/scene.html?project=spin&scene=scenes%2Fspin.scene.json&edit=1",
      restricted: true,
    });
    const file = JSON.parse(readFileSync(join(root, "state", "projects.json"), "utf8")) as {
      projects: Record<string, unknown>;
    };
    expect(file.projects.spin).toEqual({ dir, restricted: true });
    expect((await post("/api/projects/trust", { key: "spin" })).status).toBe(200);
    const trusted = JSON.parse(readFileSync(join(root, "state", "projects.json"), "utf8")) as {
      projects: Record<string, unknown>;
    };
    expect(trusted.projects.spin).toBe(dir);
    const state = (await (await get("/api/state")).json()) as { projects: { key: string; trusted: boolean }[] };
    expect(state.projects.map((p) => [p.key, p.trusted])).toEqual([["spin", true]]);
    const short = await fetch(`${studio.origin}/p/spin`, { headers: { cookie }, redirect: "manual" });
    expect(short.headers.get("location")).toBe(opened.url);
    // A closed project (an idle one) opens again with its short link.
    expect((await post("/api/projects/close", { key: "spin" })).status).toBe(200);
    const closed = (await (await get("/api/state")).json()) as { open: { key: string }[] };
    expect(closed.open.map((project) => project.key)).toEqual([]);
    const again = await fetch(`${studio.origin}/p/spin`, { headers: { cookie }, redirect: "manual" });
    expect(again.headers.get("location")).toBe(opened.url);
    const reopened = (await (await get("/api/state")).json()) as { open: { key: string }[] };
    expect(reopened.open.map((project) => project.key)).toEqual(["spin"]);
  });

  test("forwards pages to the scene server with no studio cookie, and the Hub at /", async () => {
    expect(await (await get("/scene.html?project=spin")).text()).toBe("scene /scene.html?project=spin cookie=");
    expect(await (await get("/")).text()).toStartWith("scene /hub.html");
  });

  test("forwards a WebSocket to the scene server", async () => {
    const answer = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${studio.origin.replace("http", "ws")}/`, {
        headers: { cookie, origin: studio.origin },
      } as never);
      ws.onopen = () => ws.send("hello");
      ws.onmessage = (event) => {
        resolve(String(event.data));
        ws.close();
      };
      ws.onerror = () => reject(new Error("socket error"));
    });
    expect(answer).toBe("echo hello");
  });

  test("lists folders under the roots only and makes a folder", async () => {
    expect((await get(`/api/folders?path=${encodeURIComponent(root)}`)).status).toBe(200);
    expect((await get("/api/folders?path=%2F")).status).toBe(400);
    const made = (await (await post("/api/folders", { parent: root, name: "new" })).json()) as { path: string };
    expect(made.path).toBe(join(root, "new"));
    expect((await post("/api/folders", { parent: root, name: "../x" })).status).toBe(400);
  });

  test("keeps the user state", async () => {
    const prefs = (await (await get("/api/user/preferences")).json()) as Record<string, unknown>;
    const put = await fetch(`${studio.origin}/api/user/preferences`, {
      method: "PUT",
      headers: { cookie, origin: studio.origin, [CSRF_HEADER]: csrf },
      body: JSON.stringify({ ...prefs, theme: "light" }),
    });
    expect(put.status).toBe(200);
    expect(((await (await get("/api/user/preferences")).json()) as { theme: string }).theme).toBe("light");
  });

  test("runs scenity check as a job", async () => {
    const job = (await (await post("/api/jobs", { command: "check", args: {}, cwd: join(root, "spin") })).json()) as {
      id: string;
    };
    let state = "";
    for (let i = 0; i < 200 && !["done", "failed"].includes(state); i += 1) {
      await Bun.sleep(100);
      state = ((await (await get(`/api/jobs/${job.id}`)).json()) as { job: { state: string } }).job.state;
    }
    expect(state).toBe("done");
  }, 30_000);

  test("saves a project as a template; a create job with its ID copies it", async () => {
    const saved = await post("/api/templates", { key: "spin", title: "My spin", description: "A spinner." });
    expect(await saved.json()).toEqual({
      id: "user:my-spin",
      source: "user",
      title: "My spin",
      description: "A spinner.",
      picture: false,
    });
    const listed = (await (await get("/api/templates")).json()) as { templates: { id: string }[] };
    expect(listed.templates.map((template) => template.id)).toContain("user:my-spin");
    const args = { name: "from-template", template: "user:my-spin", json: true };
    const job = (await (await post("/api/jobs", { command: "create", args, cwd: root })).json()) as { id: string };
    let state = "";
    for (let i = 0; i < 200 && !["done", "failed"].includes(state); i += 1) {
      await Bun.sleep(100);
      state = ((await (await get(`/api/jobs/${job.id}`)).json()) as { job: { state: string } }).job.state;
    }
    expect(state).toBe("done");
    const project = JSON.parse(readFileSync(join(root, "from-template", "scenity.project.json"), "utf8")) as {
      id: string;
      plugins: string[];
    };
    expect(project).toMatchObject({ id: "from-template", plugins: ["./plugins/demo"] });
    // The page names a template by its ID only.
    const folder = await post("/api/jobs", { command: "create", args: { name: "x", from: root }, cwd: root });
    expect(folder.status).toBe(400);
    const unknown = await post("/api/jobs", { command: "create", args: { name: "x", template: "user:no" }, cwd: root });
    expect(unknown.status).toBe(400);
  }, 30_000);

  test("runs a job in an allowed folder only", async () => {
    const outside = await post("/api/jobs", { command: "check", args: {}, cwd: "/" });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: string }).error).toContain("outside the allowed folders");
  });

  test("refuses foreign requests", async () => {
    const foreign = await fetch(`${studio.origin}/api/projects/close`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", [CSRF_HEADER]: csrf },
      body: "{}",
    });
    expect(foreign.status).toBe(403);
    const rebinding = await fetch(`${studio.origin}/api/state`, { headers: { cookie, host: "evil.example" } });
    expect(rebinding.status).toBe(421);
    const noCsrf = await fetch(`${studio.origin}/api/projects/close`, {
      method: "POST",
      headers: { cookie, origin: studio.origin },
      body: "{}",
    });
    expect(noCsrf.status).toBe(403);
  });
});

describe("the studio arguments", () => {
  test("keep the root folders in order and make them absolute", async () => {
    const { parseStudioArgs } = await import("../src/main");
    const args = parseStudioArgs(["--root", "/work", "--root", "rel", "--no-open"]);
    expect(args.roots).toEqual(["/work", join(process.cwd(), "rel")]);
    expect(args.open).toBe(false);
    expect(parseStudioArgs([]).roots).toEqual([]);
  });
});
