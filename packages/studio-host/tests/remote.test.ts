// SPDX-License-Identifier: Apache-2.0
// The studio in remote mode: the host on 127.0.0.1 with a public origin, behind the gateway of the studio (gateway.ts).
// A request through the gateway with the public Host header passes; another Host, or the host secret, fails. The launch
// links have the public origin. In remote mode the host opens no shell, a file write of an agent asks in Auto mode too,
// an editor cannot choose Auto, and the socket of a viewer gets no terminal output.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, TOKEN_HEADER } from "../src/access";
import { scriptDriver } from "../src/agents/driver";
import type { AgentItem, AgentSessionView } from "../src/agents/protocol";
import { publicOriginOf, startStudioGateway, studioGatewayEnv } from "../src/gateway";
import { freePort } from "../src/process";
import { startStudio, type Studio } from "../src/server";

const dir = mkdtempSync(join(tmpdir(), "studio-remote-"));
const ECHO = join(dir, "echo.sh");
writeFileSync(ECHO, 'echo "ready"\nwhile read -r line; do echo "got:$line"; done\n');
let studio: Studio;
let gateway: ReturnType<typeof startStudioGateway>;
let publicOrigin = "";
let project = "";

beforeAll(async () => {
  const gatewayPort = await freePort();
  publicOrigin = `http://studio.test:${String(gatewayPort)}`;
  studio = await startStudio({
    port: await freePort(),
    stateDir: join(dir, "state"),
    sceneServer: () => null,
    roots: [dir],
    publicOrigin,
    terminalProgram: () => ["/bin/sh", ECHO],
    agents: scriptDriver({ turns: [[{ write: { path: "notes.md", text: "one\n" } }, { say: "done" }]] }),
  });
  gateway = startStudioGateway({ publicOrigin, hostOrigin: studio.origin }, gatewayPort, "127.0.0.1");
  const folder = join(dir, "showroom");
  cpSync(
    join(import.meta.dir, "..", "..", "..", "samples", "showroom", "scenity.project.json"),
    join(folder, "scenity.project.json"),
  );
  project = studio.context.registry.add(folder).key;
});

afterAll(async () => {
  await gateway.stop(true);
  await studio.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** A request through the gateway with a Host header (default: the public origin). */
function through(path: string, init: RequestInit = {}, host = new URL(publicOrigin).host): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  return fetch(`http://127.0.0.1:${String(gateway.port)}${path}`, { ...init, headers, redirect: "manual" });
}

/** A browser of a role: the cookies of a launch link through the gateway, and its requests. */
async function browserOf(role: "admin" | "editor" | "viewer") {
  const made = await fetch(`${studio.origin}/api/launch-code`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: studio.access.secret, "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const { url } = (await made.json()) as { url: string };
  expect(url.startsWith(`${publicOrigin}/launch?code=`)).toBe(true);
  const launch = await through(new URL(url).pathname + new URL(url).search);
  expect(launch.status).toBe(303);
  const value = (name: string): string =>
    launch.headers
      .getSetCookie()
      .find((line) => line.startsWith(`${name}=`))
      ?.split(";")[0]
      ?.slice(name.length + 1) ?? "";
  const csrf = value(CSRF_COOKIE);
  const cookie = `${SESSION_COOKIE}=${value(SESSION_COOKIE)}; ${CSRF_COOKIE}=${csrf}`;
  const send = (path: string, method = "GET", body?: unknown): Promise<Response> =>
    through(path, {
      method,
      headers: { cookie, origin: publicOrigin, [CSRF_HEADER]: csrf, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const events = (): Promise<{ socket: WebSocket; seen: string[] }> => {
    const seen: string[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${String(gateway.port)}/events`, {
      headers: { cookie, origin: publicOrigin, host: new URL(publicOrigin).host },
    } as never);
    socket.onmessage = (message) => seen.push(String(message.data));
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve({ socket, seen }), { once: true });
      socket.addEventListener("error", () => reject(new Error("the events socket did not open")), { once: true });
    });
  };
  return { send, events, cookie };
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out: ${what}`);
}

describe("the studio in remote mode", () => {
  test("the gateway takes the public origin only, and the launch links have it", async () => {
    expect(publicOriginOf("https://studio.example.com/")).toBe("https://studio.example.com");
    expect(publicOriginOf("https://studio.example.com/studio")).toBeNull();
    expect(publicOriginOf("ftp://studio.example.com")).toBeNull();
    expect(() => studioGatewayEnv({})).toThrow("SCENITY_STUDIO_PUBLIC_ORIGIN");
    expect(
      studioGatewayEnv({ SCENITY_STUDIO_PUBLIC_ORIGIN: "https://s.example.com", SCENITY_STUDIO_PORT: "5171" }),
    ).toEqual({
      port: 8080,
      hostname: "0.0.0.0",
      setup: { publicOrigin: "https://s.example.com", hostOrigin: "http://127.0.0.1:5171" },
    });
    expect(studio.launchUrl("/").startsWith(`${publicOrigin}/launch?code=`)).toBe(true);
    expect(await (await through("/health")).json()).toMatchObject({ studio: true });
    const owner = await browserOf("admin");
    expect(await (await owner.send("/api/state")).json()).toMatchObject({ role: "admin", remote: true });
    // Another Host (a DNS-rebinding page), and the host secret, fail at the gateway.
    expect((await through("/api/state", {}, `evil.test:${String(gateway.port)}`)).status).toBe(421);
    expect((await through("/api/state", { headers: { [TOKEN_HEADER]: studio.access.secret } })).status).toBe(403);
    // A write with the public origin passes; a write from another origin fails in the host.
    expect((await owner.send("/api/launch-code", "POST", { role: "viewer" })).status).toBe(200);
    const foreign = await through("/api/launch-code", {
      method: "POST",
      headers: { cookie: owner.cookie, origin: "https://evil.test" },
    });
    expect(foreign.status).toBe(403);
  });

  test("no shell; a file write of Auto asks; an editor has no Auto; a viewer gets no terminal output", async () => {
    const owner = await browserOf("admin");
    const shell = await owner.send("/api/terminals", "POST", { kind: "shell", project, cols: 80, rows: 24 });
    expect(await shell.json()).toMatchObject({ error: "This studio gives no shell." });
    const ownerEvents = await owner.events();
    const viewerEvents = await (await browserOf("viewer")).events();
    const opened = (await (
      await owner.send("/api/terminals", "POST", { kind: "claude", project, cols: 80, rows: 24 })
    ).json()) as { terminal: string };
    await owner.send(`/api/terminals/${opened.terminal}/input`, "POST", { data: "ping\r" });
    await until(() => ownerEvents.seen.some((line) => line.includes("got:ping")), "the terminal output of the owner");
    expect(viewerEvents.seen.some((line) => line.includes("terminal."))).toBe(false);
    await owner.send(`/api/terminals/${opened.terminal}`, "DELETE");
    ownerEvents.socket.close();
    viewerEvents.socket.close();
    // An editor chooses Ask or Review, not Auto.
    const editor = await browserOf("editor");
    const made = (await (await editor.send("/api/agent/sessions", "POST", { project })).json()) as AgentSessionView;
    const auto = await editor.send(`/api/agent/sessions/${made.id}`, "PATCH", { mode: "auto", budgetUsd: 5 });
    expect(auto.status).toBe(403);
    expect(await auto.json()).toMatchObject({ error: expect.stringContaining("editor") as unknown });
    expect((await editor.send(`/api/agent/sessions/${made.id}`, "PATCH", { mode: "ask" })).status).toBe(200);
    // The owner chooses Auto; a file write of the agent still asks in remote mode.
    const session = (await (
      await owner.send("/api/agent/sessions", "POST", { project, mode: "auto", budgetUsd: 5 })
    ).json()) as AgentSessionView;
    await owner.send(`/api/agent/sessions/${session.id}/prompt`, "POST", { text: "write the notes" });
    const items = (): readonly AgentItem[] => studio.agents?.list().find((item) => item.id === session.id)?.items ?? [];
    await until(() => items().some((item) => item.kind === "approval"), "the approval card of the file write");
    expect(items().find((item) => item.kind === "approval")).toMatchObject({ kind: "approval", decision: null });
    studio.agents?.stop(session.id);
  });
});
