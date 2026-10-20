// SPDX-License-Identifier: Apache-2.0
// The workbench bridge of the lab page: a fake workbench page in the parent frame calls
// the lab API, and the bridge answers only the workbench origin in the parent frame.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Room3DLabApi } from "../../src/core/useLabApi";
import { cloneable, isBridgeEvent, transferOf } from "@scenity/bridge";
import { createWorkbenchBridge, startWorkbenchBridge, type BridgeHost } from "../../src/core/bridge/workbenchBridge";
import { overlayText } from "../../src/core/bridge/workbenchConsole";
import { updateFiles, watchHmr, type HotContext } from "../../src/core/bridge/workbenchEvents";

/** Each event of the page follows the one contract of `@scenity/bridge` (bridge-contract.vitest.ts). */
function expectProtocolEvent(message: Record<string, unknown> | undefined): void {
  expect(isBridgeEvent(message), JSON.stringify(message)).toBe(true);
}

const ORIGIN = "http://127.0.0.1:4800";

/** A fake parent frame: it keeps each message and its target origin. */
function fakeParent() {
  const messages: { message: Record<string, unknown>; origin: string; transfer: readonly unknown[] }[] = [];
  return {
    messages,
    postMessage(message: unknown, origin: string, transfer: readonly unknown[] = []) {
      messages.push({ message: message as Record<string, unknown>, origin, transfer });
    },
    answers: () => messages.map((item) => item.message).filter((message) => "id" in message),
    events: (name: string) => messages.map((item) => item.message).filter((message) => message.event === name),
  };
}

/** A part of the lab API: enough for the calls of the tests. */
function fakeApi(): Room3DLabApi {
  let time = 0;
  const api = {
    time: () => time,
    seek(ms: number) {
      time = ms;
    },
    errors: () => Promise.resolve(["asset x failed"]),
    load(name: string) {
      throw new Error(`No take "${name}".`);
    },
    state: () => ({ members: [{ id: "ada" }] }),
  };
  return api as unknown as Room3DLabApi;
}

describe("the calls of the bridge", () => {
  const api = fakeApi();
  let parent: ReturnType<typeof fakeParent>;
  let bridge: ReturnType<typeof createWorkbenchBridge>;
  beforeEach(() => {
    parent = fakeParent();
    bridge = createWorkbenchBridge({
      origin: ORIGIN,
      parent,
      api: () => api,
      calls: { url: () => "http://lab/?take=greet", capture: (args) => ({ width: args[0] }) },
    });
  });
  const call = (id: number, name: string, args?: unknown[], from: { source?: unknown; origin?: string } = {}) =>
    bridge.receive({
      source: "source" in from ? from.source : parent,
      origin: from.origin ?? ORIGIN,
      data: { workbench: 1, id, call: name, ...(args === undefined ? {} : { args }) },
    });

  it("answers a method of the lab API and a call of the bridge, to the workbench origin only", async () => {
    await call(1, "seek", [6350]);
    await call(2, "time");
    await call(3, "errors");
    await call(4, "url");
    await call(5, "capture", [640]);
    expect(parent.answers()).toEqual([
      { workbench: 1, id: 1, result: null },
      { workbench: 1, id: 2, result: 6350 },
      { workbench: 1, id: 3, result: ["asset x failed"] },
      { workbench: 1, id: 4, result: "http://lab/?take=greet" },
      { workbench: 1, id: 5, result: { width: 640 } },
    ]);
    expect(new Set(parent.messages.map((item) => item.origin))).toEqual(new Set([ORIGIN]));
    expect(parent.messages.every((item) => item.transfer.length === 0)).toBe(true);
  });

  it("moves the picture bytes of a result to the page in the transfer list, without a clone", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70]).buffer;
    const pictures = createWorkbenchBridge({
      origin: ORIGIN,
      parent,
      api: () => api,
      calls: { capture: () => ({ simMs: 5, width: 4, height: 1, mime: "image/webp", bytes }) },
    });
    const clone = vi.spyOn(globalThis, "structuredClone");
    await pictures.receive({ source: parent, origin: ORIGIN, data: { workbench: 1, id: 9, call: "capture" } });
    const [sent] = parent.messages;
    expect(sent?.message).toEqual({
      workbench: 1,
      id: 9,
      result: { simMs: 5, width: 4, height: 1, mime: "image/webp", bytes },
    });
    expect(sent?.transfer).toEqual([bytes]);
    expect((sent?.message.result as { bytes: unknown }).bytes).toBe(bytes);
    expect(clone).not.toHaveBeenCalled();
    expect(transferOf({ bytes: "AAAA" })).toEqual([]);
    expect(transferOf(null)).toEqual([]);
  });

  it("does not answer another origin, another source or a message that is not a call", async () => {
    await call(1, "time", [], { origin: "http://127.0.0.1:9999" });
    await call(2, "time", [], { source: null });
    await call(3, "time", [], { source: {} });
    await bridge.receive({ source: parent, origin: ORIGIN, data: { id: 4, call: "time" } });
    await bridge.receive({ source: parent, origin: ORIGIN, data: "time" });
    expect(parent.messages).toEqual([]);
  });

  it("gives an error with the list of calls for an unknown call", async () => {
    await call(1, "drop");
    await call(2, "toString");
    const [unknown, inherited] = parent.answers();
    expect(unknown?.error).toBe('No call "drop". Calls: capture, errors, load, seek, state, time, url.');
    expect(String(inherited?.error)).toContain('No call "toString"');
  });

  it("gives the message of a call that throws", async () => {
    await call(1, "load", ["nothing"]);
    expect(parent.answers()).toEqual([{ workbench: 1, id: 1, error: 'No take "nothing".' }]);
  });

  it("sends a result that structured clone refuses through JSON", () => {
    const value = { name: "x", run: () => 1, nested: { at: 2 } };
    expect(cloneable(value)).toEqual({ name: "x", nested: { at: 2 } });
    expect(cloneable(undefined)).toBeNull();
    const plain = { a: [1, 2] };
    expect(cloneable(plain)).toBe(plain);
  });

  it("sends events with the key of the bridge", () => {
    bridge.emit({ event: "url", url: "http://lab/?t=1" });
    expect(parent.messages).toEqual([
      { message: { workbench: 1, event: "url", url: "http://lab/?t=1" }, origin: ORIGIN, transfer: [] },
    ]);
  });
});

/** A fake window for startWorkbenchBridge. */
function fakeHost(search: string) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const location = { href: `http://127.0.0.1:5175/${search}`, search };
  const host = {
    parent: fakeParent(),
    location,
    console: { error: vi.fn(), warn: vi.fn() },
    history: {
      replaceState(_state: unknown, _unused: string, url?: string | URL | null) {
        if (url !== undefined && url !== null) location.href = String(url);
      },
      pushState() {
        // The lab does not push.
      },
    },
    document: { querySelector: () => null },
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: object) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
  return host;
}

describe("the bridge of the lab page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.__room3dLab = fakeApi();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.__room3dLab = undefined;
  });
  const search = `?take=greet&workbench=${encodeURIComponent(ORIGIN)}`;

  it("does not exist without the workbench parameter or outside a frame", () => {
    const plain = fakeHost("?take=greet");
    expect(startWorkbenchBridge({ view: () => null, host: plain })).toBeNull();
    const top = fakeHost(search) as unknown as { parent: unknown };
    top.parent = top;
    expect(startWorkbenchBridge({ view: () => null, host: top as unknown as BridgeHost })).toBeNull();
    expect(globalThis.__workbench).toBeUndefined();
    expect(plain.listenerCount()).toBe(0);
  });

  it("sends ready, answers url and console, and sends the url and console events", async () => {
    const host = fakeHost(search);
    const stop = startWorkbenchBridge({ view: () => null, host: host });
    expect(stop).not.toBeNull();
    expect(globalThis.__workbench?.origin).toBe(ORIGIN);
    await vi.advanceTimersByTimeAsync(100);
    const [ready] = host.parent.events("ready");
    expect(ready).toEqual({ workbench: 1, event: "ready", url: host.location.href });
    expect(globalThis.__workbench?.calls()).toEqual([
      "capture",
      "console",
      // The lines of the context packet from the page.
      "contextLines",
      "errors",
      // The drop of the desktop shell (a hint while a file is over the frame, the drop point of a path).
      "importDragHint",
      "importDropAt",
      // The state and the optimized model of an import job.
      "importPreview",
      "importStatus",
      // The frame index.
      "indexChanged",
      "indexInput",
      "indexJob",
      "indexPlan",
      // A message of the clock link from another window.
      "link",
      "load",
      "moments",
      // The answer of the host to a promote.
      "promoteResult",
      // A new scratch prop and the models of the scratch props.
      // The query of the scene document of the plugin.
      "scene.query",
      "scratchAdd",
      "scratchModel",
      "seek",
      "sheet",
      "state",
      "time",
      // The tools of the page.
      "tools",
      "tools.call",
      "url",
      // The tab of the frame is hidden or in front.
      "visibility",
    ]);

    // The lab changes its URL many times a second: one url event in the gap.
    host.history.replaceState(null, "", `http://127.0.0.1:5175/${search}&t=100`);
    host.history.replaceState(null, "", `http://127.0.0.1:5175/${search}&t=200`);
    await vi.advanceTimersByTimeAsync(300);
    expect(host.parent.events("url")).toEqual([
      { workbench: 1, event: "url", url: `http://127.0.0.1:5175/${search}&t=200` },
    ]);

    // The errors and warnings since the last call; a new error sends a console event.
    const page = host.console as unknown as Console;
    page.error("first", new Error("boom"));
    page.warn("slow frame");
    host.dispatch("unhandledrejection", { reason: new Error("lost") });
    await vi.advanceTimersByTimeAsync(300);
    expect(host.parent.events("console")).toEqual([
      {
        workbench: 1,
        event: "console",
        level: "error",
        text: expect.stringContaining("unhandled rejection") as string,
      },
    ]);
    for (const item of host.parent.messages) if (!("id" in item.message)) expectProtocolEvent(item.message);
    const message = (id: number, call: string) => ({
      source: host.parent,
      origin: ORIGIN,
      data: { workbench: 1, id, call },
    });
    host.dispatch("message", message(1, "console"));
    host.dispatch("message", message(2, "console"));
    host.dispatch("message", message(3, "url"));
    await vi.advanceTimersByTimeAsync(0);
    const [first, second, url] = host.parent.answers();
    const entries = first?.result as { errors: string[]; warnings: string[] };
    expect(entries.errors).toHaveLength(2);
    expect(entries.errors[0]).toContain("first Error: boom");
    expect(entries.errors[1]).toContain("unhandled rejection: Error: lost");
    expect(entries.warnings).toEqual(["slow frame"]);
    expect(second?.result).toEqual({ errors: [], warnings: [] });
    expect(url?.result).toBe(`http://127.0.0.1:5175/${search}&t=200`);

    stop?.();
    expect(globalThis.__workbench).toBeUndefined();
    expect(host.listenerCount()).toBe(0);
  });

  it("sends the ⌘ chords of the workbench to the page and keeps the lab keys", () => {
    const host = fakeHost(search);
    const stop = startWorkbenchBridge({ view: () => null, host: host });
    const key = (code: string, metaKey: boolean) => {
      const event = { code, metaKey, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn() };
      host.dispatch("keydown", event);
      return event.preventDefault;
    };
    expect(key("KeyK", true)).toHaveBeenCalledOnce();
    expect(key("Backslash", false)).not.toHaveBeenCalled();
    expect(key("Space", true)).not.toHaveBeenCalled();
    expect(host.parent.events("key")).toEqual([{ workbench: 1, event: "key", key: "k" }]);
    for (const event of host.parent.events("key")) expectProtocolEvent(event);
    stop?.();
  });

  it("names a capture without a 3D view as an error", async () => {
    const host = fakeHost(search);
    const stop = startWorkbenchBridge({ view: () => null, host: host });
    host.dispatch("message", { source: host.parent, origin: ORIGIN, data: { workbench: 1, id: 7, call: "capture" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.parent.answers()).toEqual([{ workbench: 1, id: 7, error: "capture: the lab has no 3D view now." }]);
    stop?.();
  });
});

describe("the events of the Vite dev server", () => {
  it("sends hmr with the paths and the accepted paths, and reload with the URL of the page", () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const hot = {
      on: (name: string, handler: (payload: unknown) => void) => handlers.set(name, handler),
      off: (name: string) => handlers.delete(name),
    } as unknown as HotContext;
    const sent: Record<string, unknown>[] = [];
    const errors: string[] = [];
    const stop = watchHmr(
      hot,
      (body) => sent.push({ workbench: 1, ...body }),
      () => "http://lab/?t=5",
      (text) => errors.push(text),
    );
    handlers.get("vite:afterUpdate")?.({
      updates: [
        { type: "js-update", path: "/src/core/Room3DLab.vue", acceptedPath: "/src/core/Room3DLab.vue" },
        { type: "js-update", path: "/src/core/LabPanel.vue", acceptedPath: "/src/core/poses.ts" },
      ],
    });
    handlers.get("vite:beforeFullReload")?.({ path: "*" });
    handlers.get("vite:error")?.({ err: { message: "x is not defined", id: "/src/a.ts" } });
    expect(sent).toEqual([
      {
        workbench: 1,
        event: "hmr",
        files: ["/src/core/Room3DLab.vue", "/src/core/LabPanel.vue", "/src/core/poses.ts"],
      },
      { workbench: 1, event: "reload", url: "http://lab/?t=5" },
    ]);
    for (const message of sent) expectProtocolEvent(message);
    expect(errors).toEqual(["vite error: x is not defined (/src/a.ts)"]);
    stop();
    expect(handlers.size).toBe(0);
    expect(updateFiles([{ path: "/a.ts" }])).toEqual(["/a.ts"]);
  });
});

describe("the text of the Vite error overlay", () => {
  it("reads the message and the file of the overlay", () => {
    const overlay = document.createElement("vite-error-overlay");
    const root = overlay.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="message">Transform failed: x is not defined</div><div class="file">src/a.ts:3</div>';
    document.body.append(overlay);
    expect(overlayText(document)).toBe("vite error overlay: Transform failed: x is not defined\nsrc/a.ts:3");
    overlay.remove();
    expect(overlayText(document)).toBeNull();
  });
});
