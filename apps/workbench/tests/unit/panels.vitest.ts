// SPDX-License-Identifier: Apache-2.0
/**
 * The detached windows of the workbench page: the panel URLs and the lab frame URL of a lab panel, the open of a
 * window in the labs app and in a browser, and the clock link between the relay and the host. The window layout of the
 * main window: the restore, a pane detach with its memory cost, and the dock back.
 */
import type { DetachedPanel, EventPayload, WindowLayout } from "@scenity/workbench-host/protocol";
import { EMPTY_LAYOUT } from "@scenity/workbench-host/protocol";
import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, shallowRef } from "vue";
import type { HostClient } from "../../src/host/hostClient";
import { deliverKept, linkToHost } from "../../src/panels/hostLink";
import { featuresOf, openPanel } from "../../src/panels/openPanel";
import { kindOfTab, newPanelKey, panelFrameUrl, panelOf, panelPageUrl, panelSearch } from "../../src/panels/panelUrl";
import { terminalKey, useWindowLayout } from "../../src/panels/useWindowLayout";
import type { SurfaceRelay } from "../../src/surfaces/relay";
import { CHECKOUT, fakeHost } from "../components/fakeHost";

const ENDPOINT = { origin: "http://127.0.0.1:4100", token: "ab".repeat(32) };
const LAB_URL = "http://127.0.0.1:5400/?take=greet&t=6350&paused=1&panes=2x2&cams=overview,chest,side,top&labKey=s3";

describe("the panel URLs", () => {
  it("reads and writes the panel of a page URL", () => {
    const panel = { key: "pane-2", kind: "pane" as const, query: { cam: "view:1,2,3,0,1,0,40" } };
    expect(panelOf(`?${panelSearch(panel)}`)).toEqual(panel);
    expect(panelOf("?panel=runs")).toEqual({ key: "runs", kind: "runs", query: {} });
    expect(panelOf("?panel=nope")).toBeNull();
    expect(panelOf("?take=greet")).toBeNull();
    const url = new URL(panelPageUrl("http://127.0.0.1:5300/?host=x&old=1#a", panel, ENDPOINT));
    expect(url.searchParams.get("panel")).toBe("pane");
    expect(url.searchParams.get("host")).toBe(ENDPOINT.origin);
    expect(url.searchParams.get("old")).toBeNull();
    expect(url.hash).toBe(`#token=${ENDPOINT.token}`);
  });

  it("makes the follower lab frame of each lab panel from the lab URL of the main window", () => {
    const pane = new URL(panelFrameUrl({ kind: "pane", query: { cam: "chest" } }, LAB_URL)).searchParams;
    expect(Object.fromEntries(pane)).toEqual({
      take: "greet",
      t: "6350",
      paused: "1",
      labKey: "s3",
      follow: "1",
      panel: "0",
      camera: "chest",
      dock: "0",
    });
    const free = new URL(panelFrameUrl({ kind: "pane", query: { cam: "view:1,2,3,0,1,0,40" } }, LAB_URL));
    expect(free.searchParams.get("view")).toBe("1,2,3,0,1,0,40");
    const dock = new URL(panelFrameUrl({ kind: "dock", query: {} }, `${LAB_URL}&item=clip_wave_hover`)).searchParams;
    expect([dock.get("only"), dock.get("dock"), dock.get("item"), dock.get("panes")]).toEqual([
      "dock",
      "tall",
      "clip_wave_hover",
      null,
    ]);
    expect(new URL(panelFrameUrl({ kind: "graph", query: {} }, LAB_URL)).searchParams.get("view")).toBe("graph");
  });

  it("gives a pane the first free key and a dock tab its kind", () => {
    expect(newPanelKey("pane", ["pane-1", "pane-3"])).toBe("pane-2");
    expect(newPanelKey("runs", [])).toBe("runs");
    expect(kindOfTab("Changes")).toBe("changes");
    expect(kindOfTab("Nope")).toBeNull();
  });
});

describe("the open of a detached window", () => {
  const panel: DetachedPanel = {
    key: "runs",
    kind: "runs",
    query: {},
    rect: { x: 40, y: 60, width: 700, height: 500 },
  };

  it("asks the shell for a native window in the labs app", async () => {
    const invoke = vi.fn(() => Promise.resolve("panel-main-runs"));
    const win = { location: { href: "tauri://localhost/index.html" }, open: vi.fn(), __TAURI_INTERNALS__: { invoke } };
    expect(await openPanel(panel, null, win)).toBe("tauri");
    expect(invoke).toHaveBeenCalledWith("open_panel", {
      request: { key: "runs", query: "panel=runs&key=runs", title: "Scenity — Runs", rect: panel.rect },
    });
    expect(win.open).not.toHaveBeenCalled();
  });

  it("opens a browser window on the same host, or tells that the browser blocked it", async () => {
    const opened: unknown[][] = [];
    const win = {
      location: { href: "http://127.0.0.1:5300/?host=x" },
      open: (...args: unknown[]) => {
        opened.push(args);
        return opened.length === 1 ? {} : null;
      },
    };
    expect(await openPanel(panel, ENDPOINT, win)).toBe("browser");
    expect(opened[0]?.[1]).toBe("scenity-panel-runs");
    expect(opened[0]?.[2]).toBe("popup,width=700,height=500,left=40,top=60");
    expect(await openPanel(panel, ENDPOINT, win)).toBe("blocked");
    expect(featuresOf({ kind: "pane", rect: null })).toBe("popup,width=960,height=600");
  });
});

/** A relay that records the calls into the lab frame and answers them from a function. */
function fakeRelay(answer: (call: string, args: readonly unknown[]) => unknown = () => 1) {
  const calls: { call: string; args: readonly unknown[] }[] = [];
  const relay = {
    has: () => true,
    // The scene surface of the built-in project.
    idWith: () => "lab",
    call: (_surface: string, _where: string, call: string, args: readonly unknown[] = []) => {
      calls.push({ call, args });
      return Promise.resolve(answer(call, args));
    },
  };
  return { relay: relay as unknown as SurfaceRelay, calls };
}

describe("the clock link of the page", () => {
  it("sends the link of the visible lab frame only, and keeps the clock state", () => {
    const { host, calls } = fakeHost({ answers: { "link.post": () => null } });
    const send = linkToHost(host.request, () => "lab");
    const message = { kind: "clock", from: "a", state: {} };
    send("lab", "visible", { workbench: 1, event: "link", channel: "scenity-clock", message });
    send("lab", "shadow", { workbench: 1, event: "link", channel: "scenity-clock", message });
    send("lab", "visible", { workbench: 1, event: "link", channel: "scenity-clock", message: { kind: "hello" } });
    expect(calls.map((call) => call.params)).toEqual([
      { channel: "scenity-clock", message, keep: true },
      { channel: "scenity-clock", message: { kind: "hello" }, keep: false },
    ]);
  });

  it("gives the kept clock to the frame until a listener takes it", async () => {
    const { host } = fakeHost({ answers: { "link.kept": () => ({ message: { kind: "clock" } }) } });
    let listeners = 0;
    const { relay, calls } = fakeRelay(() => listeners++);
    expect(await deliverKept(host.request, relay, { tries: 5, gapMs: 1 })).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ call: "link", args: [{ channel: "scenity-clock", message: { kind: "clock" } }] });
  });
});

/** A host client with the `on` of the events (the layout events of a test). */
function fakeClient() {
  const listeners = new Map<string, ((payload: never) => void)[]>();
  const client = {
    on(type: string, listener: (payload: never) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      return () => undefined;
    },
  };
  const emit = <T extends "layout.state">(type: T, payload: EventPayload<T>): void => {
    for (const listener of listeners.get(type) ?? []) (listener as (value: EventPayload<T>) => void)(payload);
  };
  return { client: client as unknown as HostClient, emit };
}

function layoutWith(patch: Partial<WindowLayout>): WindowLayout {
  return { ...EMPTY_LAYOUT, ...patch };
}

describe("the window layout of the main window", () => {
  it("restores the Claude column, the dock tab, the place and the windows that are not open", async () => {
    const saved = layoutWith({
      claude: false,
      dockTab: "Runs",
      main: { x: 10, y: 20, width: 1300, height: 820 },
      detached: [
        { key: "graph", kind: "graph", query: {}, rect: null },
        { key: "pane-1", kind: "pane", query: { cam: "chest" }, rect: { x: 0, y: 0, width: 900, height: 560 } },
      ],
    });
    const { host, calls } = fakeHost({ answers: { "layout.get": () => ({ layout: saved, open: ["graph"] }) } });
    const invoke = vi.fn(() => Promise.resolve(null));
    const win = { location: { href: "tauri://localhost/" }, open: vi.fn(), __TAURI_INTERNALS__: { invoke } };
    const claudeOpen = ref(true);
    const dockTab = ref<string | null>(null);
    const scope = effectScope();
    const api = scope.run(() =>
      useWindowLayout({ host, relay: fakeRelay().relay, claudeOpen, dockTab, win, storage: null }),
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(calls[0]).toEqual({ type: "layout.get", params: { main: true } });
    expect(claudeOpen.value).toBe(false);
    expect(dockTab.value).toBe("Runs");
    expect(api?.detached("claude")).toBe(false);
    expect(api?.detached("pane")).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "place_window", { rect: saved.main });
    expect(invoke).toHaveBeenNthCalledWith(2, "open_panel", {
      request: expect.objectContaining({ key: "pane-1", query: "panel=pane&key=pane-1&p.cam=chest" }) as unknown,
    });
    scope.stop();
  });

  it("asks once for the memory cost of a pane, takes the pane from the lab, and puts it back at a dock back", async () => {
    let layout = EMPTY_LAYOUT;
    const { host, calls } = fakeHost({
      answers: {
        "layout.get": () => ({ layout, open: [] }),
        "layout.set": (params) => {
          layout = { ...layout, ...(params as object) };
          return { layout, open: [] };
        },
        "layout.detach": (params) => {
          layout = { ...layout, detached: [(params as { panel: DetachedPanel }).panel] };
          return { layout, open: [] };
        },
      },
    });
    const { client, emit } = fakeClient();
    (host as { client: unknown }).client = shallowRef(client);
    const { relay, calls: frameCalls } = fakeRelay((call) => (call === "dropPane" ? "side" : 1));
    const opened: string[] = [];
    const win = { location: { href: "http://127.0.0.1:5300/" }, open: (url: string) => opened.push(url) };
    const scope = effectScope();
    const api = scope.run(() =>
      useWindowLayout({ host, relay, claudeOpen: ref(true), dockTab: ref(null), win, storage: null }),
    );
    if (api === undefined) throw new Error("no api");
    await vi.waitFor(() => expect(calls.some((call) => call.type === "layout.get")).toBe(true));
    const done = api.detach("pane", { pane: "2", cam: "side" });
    await vi.waitFor(() => expect(api.costAsk.value).not.toBeNull());
    api.costAsk.value?.(true);
    expect(await done).toBe("browser");
    expect(calls.find((call) => call.type === "layout.set")?.params).toEqual({ paneCost: true });
    expect(frameCalls[0]).toEqual({ call: "dropPane", args: [2] });
    expect(layout.detached).toEqual([{ key: "pane-1", kind: "pane", query: { cam: "side" }, rect: null }]);
    expect(new URL(opened[0] ?? "").searchParams.get("p.cam")).toBe("side");
    // The second pane detach asks nothing.
    await api.detach("pane", { pane: "1", cam: "chest" });
    expect(api.costAsk.value).toBeNull();
    // "Dock back" in the pane window: the lab gets the camera again as a pane.
    emit("layout.state", {
      layout: EMPTY_LAYOUT,
      open: [],
      docked: { key: "pane-1", kind: "pane", query: { cam: "side" }, rect: null },
    });
    await nextTick();
    expect(frameCalls.at(-1)).toEqual({ call: "addPane", args: ["side"] });
    scope.stop();
  });

  it("gives a detached Claude column the terminals of the main window", async () => {
    const { host, calls } = fakeHost({
      answers: {
        "layout.get": () => ({ layout: EMPTY_LAYOUT, open: [] }),
        "layout.detach": (params) => ({
          layout: layoutWith({ detached: [(params as { panel: DetachedPanel }).panel] }),
          open: [],
        }),
      },
    });
    const storage = { getItem: (key: string) => (key === terminalKey(CHECKOUT.path, "claude") ? "term-7" : null) };
    const win = { location: { href: "http://127.0.0.1:5300/" }, open: () => ({}) };
    const scope = effectScope();
    const api = scope.run(() =>
      useWindowLayout({ host, relay: fakeRelay().relay, claudeOpen: ref(true), dockTab: ref(null), win, storage }),
    );
    await api?.detach("claude");
    expect(calls.find((call) => call.type === "layout.detach")?.params).toEqual({
      panel: { key: "claude", kind: "claude", query: { claude: "term-7" }, rect: null },
    });
    expect(api?.detached("claude")).toBe(true);
    scope.stop();
  });
});
