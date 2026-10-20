// SPDX-License-Identifier: Apache-2.0
/**
 * The desktop path of the import by drop (the shell half): the drag and drop events of Scenity, the map of a window
 * point to the point in the lab frame, and the path that the page keeps for a drop. The listen for the window of the
 * page only, and the JSON request of a path to the host.
 */
import type { BridgeImportEvent, EventPayload } from "@scenity/workbench-host/protocol";
import { describe, expect, test } from "vitest";
import {
  createShellDrop,
  DRAG_EVENTS,
  DROP_FEATURE,
  KEPT_DROPS,
  labFrameAt,
  listenShellDrop,
  readDrag,
  type FrameDocument,
  type WindowPoint,
} from "../../src/desktop/shellDrop";
import { createImportDrop, importRequest } from "../../src/imports/importDrop";

const HOST = { origin: "http://127.0.0.1:4800", token: "ab".repeat(32) };

/** An element of a fake document with a box and a border. */
function element(tag: string, frame: string | null, box: { left: number; top: number }, border = 0): Element {
  return {
    tagName: tag,
    clientLeft: border,
    clientTop: border,
    getAttribute: (name: string) => (name === "data-frame" ? frame : null),
    getBoundingClientRect: () => ({ left: box.left, top: box.top }) as DOMRect,
  } as unknown as Element;
}

/** A document whose lab frame covers x ≥ 300 (its box at 300, 48 with a border of 1 px); a bar is at the left. */
function fakeDocument(): FrameDocument {
  const lab = element("IFRAME", "lab-visible", { left: 300, top: 48 }, 1);
  const web = element("IFRAME", "web-visible", { left: 0, top: 48 });
  const bar = element("DIV", null, { left: 0, top: 0 });
  return {
    elementFromPoint: (x, y) => (y < 48 ? bar : x >= 300 ? lab : web),
  };
}

describe("the events of the shell", () => {
  test("reads the paths and the position of a drop, and the position of a drag over", () => {
    expect(readDrag({ paths: ["/Users/o/box.glb", 3, ""], position: { x: 420, y: 310 } })).toEqual({
      paths: ["/Users/o/box.glb"],
      at: { x: 420, y: 310 },
    });
    expect(readDrag({ position: { x: 1, y: 2 } })).toEqual({ paths: [], at: { x: 1, y: 2 } });
    expect(readDrag(null)).toEqual({ paths: [], at: null });
    expect(readDrag({ paths: [], position: { x: "1", y: 2 } }).at).toBeNull();
  });

  test("maps a window point to the point in the visible lab frame, and nothing else", () => {
    const doc = fakeDocument();
    expect(labFrameAt(doc, { x: 420, y: 310 }, "lab")).toEqual({ x: 119, y: 261 });
    // Another surface, the top bar of the page: no lab point.
    expect(labFrameAt(doc, { x: 100, y: 310 }, "lab")).toBeNull();
    expect(labFrameAt(doc, { x: 420, y: 10 }, "lab")).toBeNull();
    expect(labFrameAt({ elementFromPoint: () => null }, { x: 1, y: 1 }, "lab")).toBeNull();
    // A project without a scene surface has no lab point.
    expect(labFrameAt(doc, { x: 420, y: 310 }, null)).toBeNull();
  });
});

function shellDrop(answer: unknown = { point: [0.5, 0, 1.25], on: "floor" }) {
  const calls: [string, readonly unknown[]][] = [];
  const doc = fakeDocument();
  const drop = createShellDrop({
    call: (call, args) => {
      calls.push([call, args]);
      if (call === "importDropAt" && answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(call === "importDropAt" ? answer : null);
    },
    frameAt: (at: WindowPoint) => labFrameAt(doc, at, "lab"),
  });
  return { calls, drop };
}

describe("createShellDrop", () => {
  test("gives the lab the drop ID, the file name and the point in the frame, and keeps the path once", async () => {
    const { calls, drop } = shellDrop();
    const done = await drop.drop({ paths: ["/Users/o/models/box.glb", "/Users/o/b.glb"], at: { x: 420, y: 310 } });
    expect(done).toEqual({ drop: "shell-1", answer: { point: [0.5, 0, 1.25], on: "floor" } });
    expect(calls.at(-1)).toEqual(["importDropAt", [{ drop: "shell-1", name: "box.glb", x: 119, y: 261 }]]);
    // The frame never gets the path. The import handler takes it once.
    expect(JSON.stringify(calls)).not.toContain("/Users/o");
    expect(drop.take("shell-1")).toBe("/Users/o/models/box.glb");
    expect(drop.take("shell-1")).toBeNull();
    expect(drop.take("drop-1")).toBeNull();
  });

  test("a drop outside the lab frame or without a file does nothing", async () => {
    const { calls, drop } = shellDrop();
    expect(await drop.drop({ paths: ["/Users/o/box.glb"], at: { x: 100, y: 310 } })).toBeNull();
    expect(await drop.drop({ paths: [], at: { x: 420, y: 310 } })).toBeNull();
    expect(await drop.drop({ paths: ["/Users/o/box.glb"], at: null })).toBeNull();
    expect(calls.filter(([call]) => call === "importDropAt")).toEqual([]);
  });

  test("keeps no path for another format, a refusal of the lab or a failed call", async () => {
    const png = shellDrop({ refused: "photo.png: the lab imports .glb, …" });
    const shown = await png.drop.drop({ paths: ["/Users/o/photo.png"], at: { x: 420, y: 310 } });
    expect(shown?.answer).toEqual({ refused: "photo.png: the lab imports .glb, …" });
    expect(png.calls.at(-1)?.[1]).toEqual([{ drop: "shell-1", name: "photo.png", x: 119, y: 261 }]);
    expect(png.drop.take("shell-1")).toBeNull();
    const refused = shellDrop({ refused: "no" });
    await refused.drop.drop({ paths: ["/Users/o/box.glb"], at: { x: 420, y: 310 } });
    expect(refused.drop.take("shell-1")).toBeNull();
    const failed = shellDrop(new Error("No visible frame of surface lab."));
    const answer = await failed.drop.drop({ paths: ["/Users/o/box.glb"], at: { x: 420, y: 310 } });
    expect(answer?.answer).toEqual({ error: "No visible frame of surface lab." });
    expect(failed.drop.take("shell-1")).toBeNull();
  });

  test(`keeps the paths of the last ${String(KEPT_DROPS)} drops`, async () => {
    const { drop } = shellDrop();
    for (let index = 0; index <= KEPT_DROPS; index += 1) {
      await drop.drop({ paths: [`/Users/o/m${String(index)}.obj`], at: { x: 420, y: 310 } });
    }
    expect(drop.take("shell-1")).toBeNull();
    expect(drop.take("shell-2")).toBe("/Users/o/m1.obj");
  });

  test("the hint of the scene changes only when the file enters or leaves the lab frame", async () => {
    const { calls, drop } = shellDrop();
    drop.drag({ x: 100, y: 310 });
    drop.drag({ x: 420, y: 310 });
    drop.drag({ x: 430, y: 320 });
    drop.drag({ x: 100, y: 320 });
    drop.drag({ x: 420, y: 310 });
    drop.drag(null);
    await drop.drop({ paths: ["/Users/o/box.glb"], at: { x: 420, y: 310 } });
    const hints = calls.filter(([call]) => call === "importDragHint").map(([, args]) => args[0]);
    // The drop clears the hint before the form shows. No hint call occurs, because the drag left before.
    expect(hints).toEqual([true, false, true, false]);
  });
});

/** Fake Tauri internals: the listens and their handlers. */
function fakeShell(features: readonly string[], label: string | null = "main") {
  const listens: { event: string; target: unknown; handler: number }[] = [];
  const unlistens: string[] = [];
  const callbacks = new Map<number, (message: unknown) => void>();
  let next = 1;
  const from = {
    __SCENITY_SHELL__: { features },
    __TAURI_INTERNALS__: {
      ...(label === null ? {} : { metadata: { currentWindow: { label } } }),
      transformCallback: (callback: (message: unknown) => void) => {
        const id = next++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: (command: string, args?: Record<string, unknown>) => {
        if (command === "plugin:event|listen") {
          listens.push({ event: String(args?.event), target: args?.target, handler: Number(args?.handler) });
          return Promise.resolve(listens.length);
        }
        if (command === "plugin:event|unlisten") unlistens.push(String(args?.event));
        return Promise.resolve(null);
      },
    },
  };
  const fire = (event: string, payload: unknown): void => {
    const listen = listens.find((item) => item.event === event);
    callbacks.get(listen?.handler ?? -1)?.({ event, payload });
  };
  return { from, listens, unlistens, fire };
}

describe("listenShellDrop", () => {
  test("listens to the four drag events of this window only, and stops them", async () => {
    const shell = fakeShell([DROP_FEATURE], "workbench-2");
    const { calls, drop } = shellDrop();
    const stop = await listenShellDrop(drop, shell.from);
    expect(shell.listens.map((item) => item.event).sort()).toEqual(Object.values(DRAG_EVENTS).sort());
    for (const item of shell.listens) expect(item.target).toEqual({ kind: "WebviewWindow", label: "workbench-2" });
    // The payload of Tauri: the paths and the position of the pointer in the web view.
    shell.fire(DRAG_EVENTS.over, { position: { x: 420, y: 310 } });
    shell.fire(DRAG_EVENTS.drop, { paths: ["/Users/o/box.glb"], position: { x: 420, y: 310 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.map(([call]) => call)).toEqual(["importDragHint", "importDragHint", "importDropAt"]);
    expect(drop.take("shell-1")).toBe("/Users/o/box.glb");
    stop?.();
    expect(shell.unlistens.sort()).toEqual(Object.values(DRAG_EVENTS).sort());
  });

  test("does nothing in a browser or in a shell without the feature", async () => {
    const { drop } = shellDrop();
    expect(await listenShellDrop(drop, {})).toBeNull();
    const old = fakeShell(["snapshot"]);
    expect(await listenShellDrop(drop, old.from)).toBeNull();
    expect(old.listens).toEqual([]);
    expect(await listenShellDrop(drop, fakeShell([DROP_FEATURE], null).from)).toBeNull();
  });
});

describe("the path request to the host", () => {
  const fields = { name: "box.glb", point: [0.5, 0, 1.25] as const, source: "made by me", licence: "CC0-1.0" };

  test("a desktop path is a JSON body with the token; an upload keeps its query and its bytes", () => {
    const path = importRequest(HOST.origin, HOST.token, { ...fields, drop: "shell-1" }, { path: "/Users/o/box.glb" });
    expect(path.url).toBe(`${HOST.origin}/imports`);
    expect(path.init.method).toBe("POST");
    expect(path.init.headers).toEqual({ "x-workbench-token": HOST.token, "content-type": "application/json" });
    expect(JSON.parse(path.init.body as string)).toEqual({
      path: "/Users/o/box.glb",
      point: [0.5, 0, 1.25],
      source: "made by me",
      licence: "CC0-1.0",
      drop: "shell-1",
    });
    const bytes = new Blob([new Uint8Array([1])]);
    const upload = importRequest(HOST.origin, HOST.token, { ...fields, drop: "drop-1" }, { file: bytes });
    expect(upload.url).toMatch(/\/imports\?name=box\.glb&point=0\.5%2C0%2C1\.25&/);
    expect(upload.init.body).toBe(bytes);
  });

  function event(drop: string): BridgeImportEvent {
    return { workbench: 1, event: "import", drop, file: null, ...fields };
  }

  test("an import event without a file sends the path of its drop, and the frame gets the model", async () => {
    const fetched: { url: string; init: RequestInit | undefined }[] = [];
    const calls: [string, readonly unknown[]][] = [];
    let listener: ((payload: EventPayload<"runs.done">) => void) | null = null;
    const handle = createImportDrop({
      endpoint: () => HOST,
      onRunDone: (next) => {
        listener = next;
        return () => (listener = null);
      },
      call: (call, args) => {
        calls.push([call, args]);
        return Promise.resolve(null);
      },
      pathOf: (drop) => (drop === "shell-1" ? "/Users/o/box.glb" : null),
      fetch: ((input: string, init?: RequestInit) => {
        fetched.push({ url: input, init });
        if (input.endsWith("/imports")) {
          setTimeout(() => listener?.({ run: "r1", code: 0, summary: "", outDir: null, images: [] }), 5);
          return Promise.resolve(
            Response.json({ id: "abc-0011aabb", run: "r1", name: "box.glb", point: [0.5, 0, 1.25], drop: "shell-1" }),
          );
        }
        if (input.endsWith("/record.json")) {
          const tiers = { high: { triangles: 12, bytes: 2048 }, low: { triangles: 12, bytes: 2048 } };
          return Promise.resolve(Response.json({ error: null, result: { pass: true, tiers, warnings: [] } }));
        }
        return Promise.resolve(new Response(new Uint8Array([7])));
      }) as typeof fetch,
    });
    await handle(event("shell-1"));
    expect(JSON.parse(fetched[0]?.init?.body as string)).toMatchObject({ path: "/Users/o/box.glb", drop: "shell-1" });
    expect(calls.some(([call]) => call === "scratchAdd")).toBe(true);
    expect((calls.at(-1)?.[1][0] as { state: string }).state).toBe("done");
    // A drop whose path the page does not have (a frame that names its own drop) sends nothing to the host.
    fetched.length = 0;
    await handle(event("shell-9"));
    expect(fetched).toEqual([]);
    expect((calls.at(-1)?.[1][0] as { text: string }).text).toContain("no file path of this drop");
  });
});
