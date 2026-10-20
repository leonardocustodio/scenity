// SPDX-License-Identifier: Apache-2.0
// The two paths of protocol 2: the same calls of a scene client give the same
// calls of the core and the same answers, through the render worker (the messages, a structured clone each way, the
// worker handler) and on the main thread (the core itself). The worker is a fake that runs the handler in this thread.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { RenderBackendFactory } from "@scenity/render/types";
import { createSceneClient, type SceneClient, type SceneLink } from "../src/client";
import type { ExtensionMessage, FromWorker, SceneCoreLike, ToWorker } from "../src/protocol";
import { attachSceneWorker } from "../src/worker/handler";
import { manifestOf, modelRecord } from "./sceneHelpers";

const ORIGIN = "https://scene.example";
type Call = readonly [string, ...unknown[]];

/** A core that records each call and answers "load", "patch" and "pick". */
function recordingCore(calls: Call[]): SceneCoreLike<unknown> {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  return {
    setInput: record("setInput"),
    setSurface: record("setSurface"),
    setFlags: record("setFlags"),
    setTier: record("setTier"),
    setGpuTimer: record("setGpuTimer"),
    setRenderScale: record("setRenderScale"),
    setAssets: record("setAssets"),
    pointerAt: record("pointerAt"),
    stats: (reset) => {
      calls.push(["stats", reset]);
      return {
        mode: "main",
        tier: "high",
        frames: 1,
        intervalP50: 0,
        intervalP95: 0,
        workP50: 0,
        workP95: 0,
        drawCalls: 4,
        triangles: 12,
        assets: "ready",
        loads: {},
        entities: 2,
      };
    },
    start: record("start"),
    dispose: record("dispose"),
    load: (load) => {
      calls.push(["load", load]);
      return Promise.resolve({ ok: true, entities: 2, warnings: [] });
    },
    patch: (ops) => {
      calls.push(["patch", ops]);
      return Promise.resolve({ ok: true, warnings: [] });
    },
    pickEntity: (x, y) => {
      calls.push(["pickEntity", x, y]);
      return { entity: "table", component: "model", target: null, point: [0, 1, 0], distance: 2 };
    },
    useCamera: (name) => {
      calls.push(["useCamera", name]);
      return name === "front";
    },
  };
}

/** The calls of the core of the last fake worker. */
let workerCalls: Call[] = [];
/** True: the fake worker ignores each message after "init" (a worker that does not answer). */
let silent = false;

/** A worker that runs the handler with a recording core. Each message is a structured clone, as in a real worker. */
class PipeWorker {
  readonly #listeners: ((event: MessageEvent<FromWorker>) => void)[] = [];
  #deliver: ((event: MessageEvent<ToWorker>) => void) | null = null;

  constructor() {
    workerCalls = [];
    const calls = workerCalls;
    attachSceneWorker<unknown, SceneCoreLike<unknown>>(
      {
        addEventListener: (_type, listener) => {
          this.#deliver = listener;
        },
        postMessage: (message) => {
          const data = structuredClone(message);
          for (const listener of this.#listeners) listener({ data } as MessageEvent<FromWorker>);
        },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => undefined,
      },
      (() => ({})) as unknown as RenderBackendFactory,
      {
        input: { safeParse: (value) => ({ success: true, data: value }) },
        createCore: () => recordingCore(calls),
        handle: (message, _core, post) => {
          post({ type: "echo", of: message.type });
        },
      },
    );
  }

  addEventListener(type: string, listener: (event: MessageEvent<FromWorker>) => void): void {
    if (type === "message") this.#listeners.push(listener);
  }

  postMessage(message: ToWorker): void {
    // The canvas of "init" is a transfer: the fake keeps it as it is.
    if (silent && message.type !== "init") return;
    const data = message.type === "init" ? message : structuredClone(message);
    this.#deliver?.({ data } as MessageEvent<ToWorker>);
  }

  terminate(): void {
    // Nothing runs.
  }
}

const saved = {
  location: Object.getOwnPropertyDescriptor(globalThis, "location"),
  Worker: Object.getOwnPropertyDescriptor(globalThis, "Worker"),
  OffscreenCanvas: Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas"),
};

beforeAll(() => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(`${ORIGIN}/scene.html`) });
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: PipeWorker });
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, writable: true, value: PipeWorker });
});

afterAll(() => {
  for (const name of ["location", "Worker", "OffscreenCanvas"] as const) {
    const descriptor = saved[name];
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, descriptor);
  }
});

/** A client on the worker path or on the main-thread path, with the calls of its core and its extension messages. */
async function clientOn(worker: boolean) {
  const mainCalls: Call[] = [];
  const echoes: ExtensionMessage[] = [];
  let link: SceneLink<SceneCoreLike<unknown>> | null = null;
  const canvas = { transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement;
  const client: SceneClient<unknown> = await createSceneClient<unknown, SceneCoreLike<unknown>>(
    canvas,
    {
      workerUrl: worker ? `${ORIGIN}/sceneWorker.js` : null,
      getSimMs: () => null,
      surface: { width: 640, height: 400, dpr: 1 },
      tier: "high",
      flags: { reducedMotion: false, paused: false, visible: true },
      link: (made) => {
        link = made;
        if (made.mode === "worker") made.listen((message) => echoes.push(message));
      },
    },
    () => Promise.resolve(() => Promise.resolve(recordingCore(mainCalls))),
  );
  return { client, calls: () => (worker ? workerCalls : mainCalls), echoes, link: () => link };
}

/** The same script of calls on a client. The result has the answers in order. */
async function script(client: SceneClient<unknown>): Promise<unknown[]> {
  client.setInput({ n: 1 });
  client.setSurface({ width: 800, height: 500, dpr: 2 });
  client.setFlags({ reducedMotion: true, paused: true, visible: true });
  client.setTier("medium");
  client.setGpuTimer(true);
  client.setScale(0.75);
  client.setAssets(null);
  client.pointer(5, 6, "move");
  const answers: unknown[] = [];
  const manifest = manifestOf([modelRecord("chair-0001", ["chair.glb"])]);
  answers.push(await client.load({ manifest, files: { "chair.glb": "projects/a/chair.glb" } }));
  answers.push(await client.patch([{ op: "remove", id: "lamp" }]));
  answers.push(await client.pickEntity(3, 4));
  // The camera of the view is a message of the protocol.
  answers.push(await client.useCamera("front"), await client.useCamera("no-such-camera"));
  const stats = await client.stats(true);
  answers.push({ drawCalls: stats.drawCalls, entities: stats.entities });
  client.dispose();
  return answers;
}

describe("the worker path and the main-thread path of protocol 2", () => {
  it("give the core the same calls and the client the same answers", async () => {
    const main = await clientOn(false);
    const worker = await clientOn(true);
    expect(main.client.mode).toBe("main");
    expect(worker.client.mode).toBe("worker");
    const mainAnswers = await script(main.client);
    const workerAnswers = await script(worker.client);
    expect(workerAnswers).toEqual(mainAnswers);
    expect(worker.calls()).toEqual(main.calls());
    // The manifest files are absolute and same-origin on both paths.
    expect(main.calls().find(([name]) => name === "load")).toEqual([
      "load",
      {
        manifest: manifestOf([modelRecord("chair-0001", ["chair.glb"])]),
        files: { "chair.glb": `${ORIGIN}/projects/a/chair.glb` },
      },
    ]);
  });

  it("sends the messages of an extension in an envelope and gives the answers back without it", async () => {
    const worker = await clientOn(true);
    const link = worker.link();
    if (link?.mode !== "worker") throw new Error("no worker link");
    link.send({ type: "pick", id: 1, x: 0, y: 0, pane: 0 });
    expect(worker.echoes).toEqual([{ type: "echo", of: "pick" }]);
    // The protocol "pick" did not run: the message was the labs pick of the extension.
    expect(worker.calls().some(([name]) => name === "pickEntity")).toBe(false);
    worker.client.dispose();
  });

  it("answers the open requests of a disposed worker client with the values of a worker that is gone", async () => {
    silent = true;
    const worker = await clientOn(true);
    const open = { stats: worker.client.stats(), pick: worker.client.pickEntity(1, 1), patch: worker.client.patch([]) };
    worker.client.dispose();
    silent = false;
    expect((await open.stats).frames).toBe(0);
    expect(await open.pick).toBeNull();
    expect(await open.patch).toEqual({ ok: false, index: 0, reason: "the 3D scene worker is gone" });
  });
});
