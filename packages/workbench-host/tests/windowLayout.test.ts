// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the link between the windows and of the window layout (windowLayout.ts). The link sends a message to the
 * other pages only and keeps the clock. The layout persists per checkout. A detached window that the owner closes
 * goes out of the layout, and a quit of the app keeps it. A new host on the same state folder (a restart) gives the
 * same layout.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHost, type Host } from "../src/host";
import {
  EMPTY_LAYOUT,
  isBridgeEvent,
  isEventOf,
  readLayout,
  type DetachedPanel,
  type HostEvent,
} from "../src/protocol";
import type { PageClient } from "../src/server";
import { WindowLayouts } from "../src/windowLayout";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

/** A fake page client that keeps what the host sends. */
function client(id: number): PageClient & { readonly got: unknown[] } {
  const got: unknown[] = [];
  return { id, origin: null, role: "admin" as const, got, send: (message) => got.push(message) };
}

const PANE: DetachedPanel = {
  key: "pane-1",
  kind: "pane",
  query: { cam: "chest" },
  rect: { x: 10, y: 20, width: 800, height: 500 },
};

describe("the window layouts without a server", () => {
  const dir = tempDir("window-layout");
  afterAll(() => cleanup(dir));

  function layouts(clients: PageClient[], events: HostEvent[] = [], checkout = "/repo") {
    return new WindowLayouts({
      stateDir: dir,
      checkout: () => checkout,
      clients: () => clients,
      broadcast: (event) => events.push(event),
      dropMs: 30,
    });
  }

  test("a link message goes to every other page, and the host keeps the marked message", () => {
    const [a, b, c] = [client(1), client(2), client(3)];
    const store = layouts([a, b, c]);
    store.post(a, "scenity-clock", { kind: "clock", simMs: 5 }, true);
    expect(a.got).toEqual([]);
    expect(b.got).toEqual([
      { type: "link.message", channel: "scenity-clock", from: 1, message: { kind: "clock", simMs: 5 } },
    ]);
    expect(c.got).toHaveLength(1);
    store.post(b, "scenity-clock", { kind: "seek", simMs: 9 }, false);
    expect(store.kept("scenity-clock")).toEqual({ message: { kind: "clock", simMs: 5 } });
    expect(store.kept("other")).toBeNull();
  });

  test("the layout of a checkout persists and stays apart from the other checkouts", () => {
    const events: HostEvent[] = [];
    const store = layouts([], events, "/one");
    expect(store.layout()).toEqual(EMPTY_LAYOUT);
    const panel = readLayout({ detached: [PANE] }).detached[0];
    if (panel === undefined) throw new Error("no panel");
    store.detach(panel);
    store.place("main", { x: 0, y: 0, width: 1440, height: 900 });
    store.place("pane-1", { x: 100, y: 120, width: 640, height: 400 });
    expect(events.some((event) => isEventOf(event, "layout.state"))).toBe(true);
    const again = layouts([], [], "/one");
    expect(again.layout().main).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(again.layout().detached).toEqual([{ ...PANE, rect: { x: 100, y: 120, width: 640, height: 400 } }]);
    expect(layouts([], [], "/two").layout()).toEqual(EMPTY_LAYOUT);
  });

  test("a window that the owner closes goes out; a quit of the app keeps it; a reload joins again", async () => {
    const main = client(1);
    const panel = client(2);
    const clients = [main, panel];
    const store = layouts(clients, [], "/close");
    const detached = readLayout({ detached: [PANE] }).detached[0];
    if (detached === undefined) throw new Error("no panel");
    store.detach(detached);
    // The main page marks itself with `layout.get { main: true }`.
    markMain(store, main);
    store.joined(panel, "pane-1");
    expect(store.open()).toEqual(["pane-1"]);
    // A reload: the window closes and joins again within the wait.
    clients.splice(1, 1);
    store.dropClient(panel);
    expect(store.open()).toEqual([]);
    const reloaded = client(3);
    clients.push(reloaded);
    store.joined(reloaded, "pane-1");
    await Bun.sleep(60);
    expect(store.layout().detached.map((item) => item.key)).toEqual(["pane-1"]);
    // The quit: every page closes; the layout keeps the window.
    clients.splice(0, clients.length);
    store.dropClient(reloaded);
    store.dropClient(main);
    await Bun.sleep(60);
    expect(store.layout().detached.map((item) => item.key)).toEqual(["pane-1"]);
    // The owner closes the window while the main window stays: it goes out of the layout.
    const main2 = client(4);
    const panel2 = client(5);
    clients.push(main2, panel2);
    markMain(store, main2);
    store.joined(panel2, "pane-1");
    clients.splice(1, 1);
    store.dropClient(panel2);
    await until(() => store.layout().detached.length === 0, 1_000, "the removal of the closed window");
  });

  test("the bridge events of the link and of a detach have their shapes", () => {
    const link = { workbench: 1, event: "link", channel: "scenity-clock", message: { kind: "hello", from: "a" } };
    expect(isBridgeEvent(link)).toBe(true);
    expect(isBridgeEvent({ ...link, channel: "Bad Channel" })).toBe(false);
    expect(isBridgeEvent({ ...link, message: "text" })).toBe(false);
    const detach = { workbench: 1, event: "detach", panel: "pane", query: { pane: "1", cam: "chest" } };
    expect(isBridgeEvent(detach)).toBe(true);
    expect(isBridgeEvent({ ...detach, panel: "claude" })).toBe(false);
    expect(isBridgeEvent({ ...detach, query: { "bad name": "x" } })).toBe(false);
  });

  test("a bad layout file part takes the default value", () => {
    expect(
      readLayout({ claude: "yes", dockTab: "<b>", main: { x: 0 }, detached: [{ key: "Bad Key" }, PANE, PANE] }),
    ).toEqual({ ...EMPTY_LAYOUT, detached: [PANE] });
  });
});

/** Mark a client as a main window through the request handler, as `layout.get { main: true }` does. */
function markMain(store: WindowLayouts, page: PageClient): void {
  const handlers = new Map<string, (params: unknown, client: PageClient) => unknown>();
  const router = {
    on(type: string, handler: (params: unknown, client: PageClient) => unknown) {
      handlers.set(type, handler);
      return router;
    },
  };
  store.register(router as never);
  handlers.get("layout.get")?.({ main: true }, page);
}

describe("the link and the layout of a running host", () => {
  let parent = "";
  let repo = "";
  const state = tempDir("window-layout-host");
  let host: Host;
  const start = async (): Promise<Host> =>
    startHost({ checkout: repo, stateDir: state, token: "22".repeat(32), serverCommand: fakeCommand, watch: false });

  beforeAll(async () => {
    ({ parent, repo } = await makeRepo());
    host = await start();
  });
  afterAll(async () => {
    await host.stop();
    cleanup(parent, state);
  });

  test("a link message of a detached window reaches the main window, and a new window reads the kept clock", async () => {
    const main = await FakePage.open(host.endpoint);
    const panel = await FakePage.open(host.endpoint);
    try {
      await main.call("layout.get", { main: true });
      await panel.call("layout.join", { key: "graph" });
      const clock = { kind: "clock", from: "lab-a", state: { simMs: 6000, running: false } };
      await main.call("link.post", { channel: "scenity-clock", message: clock, keep: true });
      const got = await panel.waitEvent((event) => isEventOf(event, "link.message"));
      expect(got).toMatchObject({ channel: "scenity-clock", message: clock });
      expect(main.events.some((event) => isEventOf(event, "link.message"))).toBe(false);
      const late = await FakePage.open(host.endpoint);
      expect(await late.call("link.kept", { channel: "scenity-clock" })).toEqual({ message: clock });
      late.close();
      await rejectsWith(main.call("link.post", { channel: "Bad Name", message: {} }), "channel");
      await rejectsWith(main.call("link.post", { channel: "scenity-clock", message: 3 }), "object");
    } finally {
      main.close();
      panel.close();
    }
  });

  test("a restart of the host restores the layout", async () => {
    const main = await FakePage.open(host.endpoint);
    await main.call("layout.get", { main: true });
    await main.call("layout.set", { claude: false, dockTab: "Runs", paneCost: true });
    await main.call("layout.detach", { panel: PANE });
    await main.call("layout.detach", { panel: { key: "runs", kind: "runs", query: {}, rect: null } });
    await main.call("layout.rect", { key: "main", rect: { x: 4, y: 30, width: 1280, height: 800 } });
    await rejectsWith(main.call("layout.set", { dockTab: 7 }), "dockTab");
    await rejectsWith(main.call("layout.detach", { panel: { key: "x", kind: "nope" } }), "panel");
    const before = await main.call("layout.get", {});
    main.close();
    await host.stop();
    host = await start();
    const again = await FakePage.open(host.endpoint);
    try {
      const after = (await again.call("layout.get", { main: true })) as { layout: unknown; open: string[] };
      expect(after).toEqual(before as typeof after);
      expect(after.layout).toMatchObject({
        claude: false,
        dockTab: "Runs",
        paneCost: true,
        main: { x: 4, y: 30, width: 1280, height: 800 },
      });
      // "Dock back": the window goes out, and the event names it for the main page.
      await again.call("layout.dock", { key: "pane-1" });
      const docked = await again.waitEvent((event) => isEventOf(event, "layout.state") && "docked" in event);
      expect(docked).toMatchObject({ docked: { key: "pane-1", query: { cam: "chest" } } });
    } finally {
      again.close();
    }
  });
});
