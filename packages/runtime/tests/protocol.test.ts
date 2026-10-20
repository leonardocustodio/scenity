// SPDX-License-Identifier: Apache-2.0
// Protocol 2: the projected frames of the anchors and the worker handler:
// the check of the opaque plugin input ("state"), the version of "init", the "load", "patch" and "pick" messages, the
// "flags" message with the GPU timer and the "extension" envelope.
import { describe, expect, it, spyOn } from "bun:test";
import type { RenderBackendFactory } from "@scenity/render/types";
import { nextProjectedFrame, onCanvas } from "../src/core/anchors";
import {
  PROTOCOL_VERSION,
  type ExtensionMessage,
  type FromWorker,
  type InputSchema,
  type ProjectedPoint,
  type SceneCoreLike,
  type ToWorker,
} from "../src/protocol";
import { attachSceneWorker, type SceneWorkerFactory } from "../src/worker/handler";
import { manifestOf, modelRecord } from "./sceneHelpers";

const point = (id: string, x: number, y: number, depth = 0.5, visible = true): ProjectedPoint => ({
  id,
  at: [x, y, depth],
  visible,
});

describe("the projected points", () => {
  it("is on the canvas only in front of the camera and inside the size", () => {
    expect(onCanvas(point("a", 10, 20), 100, 50)).toBe(true);
    expect(onCanvas(point("a", 100, 50), 100, 50)).toBe(true);
    expect(onCanvas(point("a", 101, 20), 100, 50)).toBe(false);
    expect(onCanvas(point("a", 10, -1), 100, 50)).toBe(false);
    expect(onCanvas(point("a", 10, 20, 1.2), 100, 50)).toBe(false);
  });

  it("sends a new frame only when a point moves, shows or leaves the canvas", () => {
    const first = nextProjectedFrame(null, 1, 100, 50, [point("a", 10, 20)]);
    expect(first).toEqual({ seq: 1, width: 100, height: 50, points: [point("a", 10, 20)] });
    expect(nextProjectedFrame(first, 2, 100, 50, [point("a", 10.4, 20.4)])).toBeNull();
    expect(nextProjectedFrame(first, 2, 100, 50, [point("a", 11, 20)])?.seq).toBe(2);
    expect(nextProjectedFrame(first, 2, 100, 50, [point("a", 10, 20, 0.5, false)])).not.toBeNull();
    expect(nextProjectedFrame(first, 2, 100, 50, [point("a", 10, 20, 1.5)])).not.toBeNull();
    expect(nextProjectedFrame(first, 2, 120, 50, [point("a", 10, 20)])).not.toBeNull();
    expect(nextProjectedFrame(first, 2, 100, 50, [point("b", 10, 20)])).not.toBeNull();
  });
});

interface Input {
  readonly n: number;
}

/** A light schema: an object with a number `n`. */
const schema: InputSchema<Input> = {
  safeParse: (value) =>
    typeof value === "object" && value !== null && typeof (value as { n?: unknown }).n === "number"
      ? { success: true, data: value as Input }
      : { success: false, error: { issues: [{ path: ["n"], message: "Expected a number" }] } },
};

type Call = readonly [string, ...unknown[]];

/** A core that records each call. `documents` adds the optional methods of a document core. */
function recordingCore(calls: Call[], documents: boolean): SceneCoreLike<Input> {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  const core: SceneCoreLike<Input> = {
    setInput: record("setInput"),
    setSurface: record("setSurface"),
    setFlags: record("setFlags"),
    setTier: record("setTier"),
    setGpuTimer: record("setGpuTimer"),
    setRenderScale: record("setRenderScale"),
    setAssets: record("setAssets"),
    pointerAt: record("pointerAt"),
    stats: () => {
      throw new Error("not used");
    },
    start: record("start"),
    dispose: record("dispose"),
  };
  if (!documents) return core;
  return {
    ...core,
    load: (load) => {
      calls.push(["load", load]);
      return Promise.resolve({ ok: true, entities: 3, warnings: [] });
    },
    patch: (ops) => {
      calls.push(["patch", ops]);
      return Promise.resolve({ ok: false, index: 1, reason: "bad op" });
    },
    pickEntity: (x, y) => {
      calls.push(["pickEntity", x, y]);
      return {
        entity: "table",
        component: "model",
        target: { kind: "node", id: "top" },
        point: [1, 0, 2],
        distance: 3,
      };
    },
  };
}

const INIT: ToWorker = {
  type: "init",
  protocol: PROTOCOL_VERSION,
  canvas: {} as OffscreenCanvas,
  surface: { width: 1, height: 1, dpr: 1 },
  tier: "low",
  flags: { reducedMotion: false, paused: false, visible: true },
  assets: null,
};

/** A worker scope with a handler on it: `send` gives it a message, and `posted` has its answers. */
function worker(options: { documents?: boolean; handle?: SceneWorkerFactory<Input, SceneCoreLike<Input>>["handle"] }) {
  let listener: ((event: MessageEvent<ToWorker>) => void) | null = null;
  const posted: FromWorker[] = [];
  const calls: Call[] = [];
  attachSceneWorker<Input, SceneCoreLike<Input>>(
    {
      addEventListener: (_type, next) => {
        listener = next;
      },
      postMessage: (message) => posted.push(message),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
    },
    (() => ({})) as unknown as RenderBackendFactory,
    {
      input: schema,
      createCore: () => recordingCore(calls, options.documents === true),
      ...(options.handle === undefined ? {} : { handle: options.handle }),
    },
  );
  const send = (data: ToWorker): void => {
    listener?.({ data } as MessageEvent<ToWorker>);
  };
  return { send, posted, calls };
}

/** Wait for the answers of the promises of the core. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the plugin input in the worker (the 'state' message)", () => {
  it("gives the core only an input that the schema of the plugin accepts", () => {
    const { send, calls } = worker({});
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    send(INIT);
    send({ type: "state", input: { n: 1 } });
    send({ type: "state", input: { n: "two" } });
    send({ type: "state", input: { n: 3 } });
    const warnings = warn.mock.calls.length;
    warn.mockRestore();
    expect(calls.filter(([name]) => name === "setInput")).toEqual([
      ["setInput", { n: 1 }],
      ["setInput", { n: 3 }],
    ]);
    expect(warnings).toBe(1);
  });
});

describe("protocol 2 in the worker", () => {
  it("refuses a page of another protocol version and makes no core", () => {
    const { send, posted, calls } = worker({});
    send({ ...INIT, protocol: 1 });
    send({ type: "state", input: { n: 1 } });
    expect(posted).toEqual([{ type: "error", message: "the page speaks protocol 1, the worker 2" }]);
    expect(calls).toEqual([]);
  });

  it("keeps the messages before 'init' and gives them to the core in order", () => {
    const { send, calls } = worker({});
    send({ type: "tier", tier: "high" });
    send({ type: "state", input: { n: 7 } });
    send(INIT);
    expect(calls.map(([name]) => name)).toEqual(["setAssets", "setTier", "setInput", "start"]);
  });

  it("gives the built assets of 'load' to setAssets, and the flags and the GPU timer of 'flags' when present", () => {
    const { send, calls, posted } = worker({});
    send(INIT);
    calls.length = 0;
    send({ type: "load", assets: null });
    send({ type: "flags", gpuTimer: true });
    send({ type: "flags", flags: { reducedMotion: true, paused: false, visible: true } });
    expect(calls).toEqual([
      ["setAssets", null],
      ["setGpuTimer", true],
      ["setFlags", { reducedMotion: true, paused: false, visible: true }],
    ]);
    expect(posted).toEqual([]);
  });

  it("refuses documents for a core without them, and gives a null pick and no camera", async () => {
    const { send, posted } = worker({});
    send(INIT);
    send({ type: "load", id: 4, manifest: manifestOf([]) });
    send({ type: "patch", id: 5, ops: [] });
    send({ type: "pick", id: 6, x: 1, y: 2 });
    send({ type: "camera", id: 7, name: "front" });
    await settle();
    expect(posted).toEqual([
      { type: "loaded", id: 4, result: { ok: false, reason: "this core takes no documents" } },
      { type: "patched", id: 5, result: { ok: false, index: 0, reason: "this core takes no documents" } },
      { type: "picked", id: 6, hit: null },
      { type: "camera", id: 7, ok: false },
    ]);
  });

  it("answers 'load', 'patch' and 'pick' of a document core with the same IDs", async () => {
    const { send, posted, calls } = worker({ documents: true });
    send(INIT);
    const manifest = manifestOf([modelRecord("a1", ["a.glb"])]);
    send({ type: "load", id: 1, manifest, files: { "a.glb": "/a.glb" }, tier: "low" });
    send({ type: "patch", id: 2, ops: [{ op: "remove", id: "lamp" }] });
    send({ type: "pick", id: 3, x: 10, y: 20 });
    send({ type: "patch", ops: [] });
    await settle();
    expect(calls.filter(([name]) => ["load", "patch", "pickEntity"].includes(name))).toEqual([
      ["load", { manifest, files: { "a.glb": "/a.glb" }, tier: "low" }],
      ["patch", [{ op: "remove", id: "lamp" }]],
      ["pickEntity", 10, 20],
      ["patch", []],
    ]);
    expect(posted).toEqual([
      {
        type: "picked",
        id: 3,
        hit: {
          entity: "table",
          component: "model",
          target: { kind: "node", id: "top" },
          point: [1, 0, 2],
          distance: 3,
        },
      },
      { type: "loaded", id: 1, result: { ok: true, entities: 3, warnings: [] } },
      { type: "patched", id: 2, result: { ok: false, index: 1, reason: "bad op" } },
    ]);
  });

  it("gives the envelope of an extension to the factory, also with a type of the protocol, and wraps its answers", () => {
    const seen: ExtensionMessage[] = [];
    const { send, posted, calls } = worker({
      handle: (message, _core, post) => {
        seen.push(message);
        post({ type: "picked", id: message.id });
      },
    });
    send(INIT);
    calls.length = 0;
    send({ type: "extension", message: { type: "pick", id: 9, x: 1, y: 2, pane: 0 } });
    expect(seen).toEqual([{ type: "pick", id: 9, x: 1, y: 2, pane: 0 }]);
    expect(posted).toEqual([{ type: "extension", message: { type: "picked", id: 9 } }]);
    expect(calls).toEqual([]);
  });

  it("ignores a type of protocol 1 and stops after 'dispose'", () => {
    const { send, calls } = worker({});
    send(INIT);
    calls.length = 0;
    send({ type: "scene", input: { n: 1 } } as unknown as ToWorker);
    send({ type: "dispose" });
    send({ type: "tier", tier: "high" });
    expect(calls).toEqual([["dispose"]]);
  });
});
