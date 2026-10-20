// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the surface RPC (the host half) and of the checkouts of a running host. A fake workbench page over a real
 * WebSocket relays the calls of the host. The dev server is the fake command.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createCheckout } from "../src/checkouts";
import { startHost, type Host } from "../src/host";
import { EDITOR_SERVER } from "../src/servers";
import { encodePictureFrame, isEventOf, PROTOCOL_VERSION, type HostEvent, type SurfaceState } from "../src/protocol";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const PAGE_ORIGIN = "http://127.0.0.1:5999";
const CAPTURE = { simMs: 100, width: 2, height: 1, mime: "image/webp" };
/** The bytes of the capture go as a binary frame before the JSON answer. */
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
let host: Host;
let page: FakePage;
let parent = "";
let repo = "";
const state = tempDir("surfaces-state");

/** The fake frame: answer each relayed call like the bridge of the lab. */
function relay(target: FakePage, event: HostEvent): void {
  if (!isEventOf(event, "surface.request")) return;
  const { request, call, args } = event;
  if (call === "slow") return;
  if (call === "fail") void target.request("surface.call", { request, error: "Unknown camera: nope" });
  else if (call === "capture" && args[0] === 0) void target.request("surface.call", { request, result: {} });
  else if (call === "capture" && args[0] === 320) {
    // A lab page of an older checkout gives base64 in the JSON answer.
    void target.request("surface.call", { request, result: { ...CAPTURE, data: "AAAA" } });
  } else if (call === "capture") {
    target.sendBinary(encodePictureFrame(request, "image/webp", BYTES));
    void target.request("surface.call", { request, result: { ...CAPTURE, bytes: BYTES.length } });
  } else if (call === "url") void target.request("surface.call", { request, result: "http://127.0.0.1:1/?t=5" });
  else void target.request("surface.call", { request, result: { call, args } });
}

function labState(target: FakePage, test: (surface: SurfaceState) => boolean): Promise<HostEvent> {
  return target.waitEvent((event) => isEventOf(event, "surface.state") && test(event.surface));
}

beforeAll(async () => {
  ({ parent, repo } = await makeRepo());
  host = await startHost({ checkout: repo, stateDir: state, token: "11".repeat(32), serverCommand: fakeCommand });
  page = await FakePage.open(host.endpoint);
  page.onEvent = (event) => relay(page, event);
});
afterAll(async () => {
  page.close();
  await host.stop();
  cleanup(parent, state);
});

describe("the hello and the surface state", () => {
  test("hello gives the protocol, the checkout and the lab surface", async () => {
    const result = (await page.call("host.hello", { origin: PAGE_ORIGIN })) as { protocol: number; checkout: unknown };
    expect(result.protocol).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe(3);
    expect(result.checkout).toMatchObject({ path: repo, branch: "main", open: true });
    const ready = await labState(page, (surface) => surface.server.status === "ready");
    const url = isEventOf(ready, "surface.state") ? ready.surface.url : null;
    // A lab frame has the render worker unless its URL state sets `worker`.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?workbench=http%3A%2F%2F127\.0\.0\.1%3A5999&worker=1$/);
  });

  test("a bad page origin fails", async () => {
    const answer = await page.request("host.hello", { origin: "javascript:alert(1)" });
    expect(answer.ok).toBe(false);
  });
});

describe("the surface RPC", () => {
  test("a call without a page that shows the surface fails", async () => {
    await rejectsWith(host.surface("lab").call("seek", [100]), "No workbench page shows the surface lab");
    await rejectsWith(host.surface("nope").call("seek"), "Unknown surface");
  });

  test("a call goes to the page that reported the frame and comes back", async () => {
    await page.call("surface.report", {
      surface: "lab",
      where: "visible",
      event: { workbench: 1, event: "ready", url: "http://127.0.0.1:1/?take=greet&t=5" },
    });
    const lab = host.surface("lab");
    expect(await lab.call("seek", [6350])).toEqual({ call: "seek", args: [6350] });
    expect(await lab.call("setCamera", ["side"])).toEqual({ call: "setCamera", args: ["side"] });
    expect(await lab.url()).toBe("http://127.0.0.1:1/?t=5");
    expect(await lab.capture(640)).toEqual({ ...CAPTURE, bytes: BYTES } as never);
    expect(await lab.capture(320)).toEqual({ ...CAPTURE, bytes: new Uint8Array([0, 0, 0]) } as never);
    await rejectsWith(lab.capture(0), "no picture");
    await rejectsWith(lab.call("seek", [1], { where: "shadow" }), "(shadow)");
  });

  test("an error of the frame and a timeout reject", async () => {
    const lab = host.surface("lab");
    await rejectsWith(lab.call("fail"), "Unknown camera: nope");
    await rejectsWith(lab.call("slow", [], { timeoutMs: 100 }), 'did not answer "slow" in 100 ms');
  });

  test("an answer of another page or to no request fails", async () => {
    const other = await FakePage.open(host.endpoint);
    page.events.length = 0;
    const pending = host.surface("lab").call("slow", [], { timeoutMs: 2000 });
    const request = await page.waitEvent((event) => isEventOf(event, "surface.request") && event.call === "slow");
    const id = isEventOf(request, "surface.request") ? request.request : -1;
    const wrong = await other.request("surface.call", { request: id, result: 1 });
    expect(wrong).toMatchObject({ ok: false, error: "The request went to another page." });
    expect(await other.request("surface.call", { request: 99_999, result: 1 })).toMatchObject({ ok: false });
    await page.call("surface.call", { request: id, result: "late but fine" });
    expect(await pending).toBe("late but fine");
    other.close();
  });

  test("the console errors and the URL of the frame stay in the host", async () => {
    const lab = host.surface("lab");
    const report = (event: object) => page.call("surface.report", { surface: "lab", where: "visible", event });
    await report({ workbench: 1, event: "console", level: "error", text: "TypeError: x" });
    await report({ workbench: 1, event: "console", level: "warn", text: "slow frame" });
    expect(lab.consoleErrors).toEqual(["TypeError: x"]);
    lab.clearConsole();
    expect(lab.consoleErrors).toEqual([]);
    await report({ workbench: 1, event: "url", url: "http://127.0.0.1:1/?take=greet&t=6350&paused=1" });
    expect(lab.state.url).toContain("t=6350");
    expect(lab.state.url).toContain(`:${String(lab.state.server.port)}/`);
    host.surfaces.flush();
    expect(host.state.surfaceUrls(repo).lab).toBe("http://127.0.0.1:1/?take=greet&t=6350&paused=1");
    const bad = await page.request("surface.report", { surface: "lab", where: "visible", event: { event: "x" } });
    expect(bad.ok).toBe(false);
  });

  test("a page that closes ends its open calls", async () => {
    const other = await FakePage.open(host.endpoint);
    await other.call("surface.report", {
      surface: "lab",
      where: "shadow",
      event: { workbench: 1, event: "ready", url: "http://127.0.0.1:1/" },
    });
    const pending = host.surface("lab").call("slow", [], { where: "shadow", timeoutMs: 5000 });
    await other.waitEvent((event) => isEventOf(event, "surface.request"));
    other.close();
    await rejectsWith(pending, "The workbench page closed.");
    await rejectsWith(host.surface("lab").call("x", [], { where: "shadow" }), "No workbench page");
  });
});

describe("the checkouts of the host", () => {
  test("a second checkout gets a second server; the lab surface follows it", async () => {
    const second = await createCheckout(repo, { branch: "two" });
    const firstServer = host.servers.ensure(repo);
    const opened = (await page.call("checkouts.open", { path: second.path })) as { surfaces: SurfaceState[] };
    expect(opened.surfaces[0]?.checkout).toBe(second.path);
    await until(() => host.surface("lab").state.server.status === "ready", 5000, "the second server");
    // The app servers of each checkout exist too. They stay stopped until their tab opens.
    expect(host.servers.all().filter((server) => server.kind === EDITOR_SERVER)).toHaveLength(2);
    expect(firstServer.info.status).toBe("ready");
    expect(host.surface("lab").state.server.port).not.toBe(firstServer.info.port);
    const list = (await page.call("checkouts.list")) as { path: string; open: boolean }[];
    expect(list.map((item) => item.open)).toEqual([true, true]);
    expect(host.state.currentCheckout()).toBe(second.path);
    expect((await page.request("checkouts.open", { path: join(parent, "absent") })).ok).toBe(false);
    const created = (await page.call("checkouts.create", { branch: "three" })) as { path: string };
    expect(created.path).toBe(join(parent, "repo-three"));
  });
});
