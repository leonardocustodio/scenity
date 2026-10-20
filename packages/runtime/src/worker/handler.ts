// SPDX-License-Identifier: Apache-2.0
/**
 * The message handler of a render worker (protocol 2). A worker entry of a plugin attaches it to the worker scope. A
 * test can attach it to a fake scope. The worker draws after the "init" message, and the messages that come before it
 * wait. The factory of the plugin makes the core and handles the messages of an extension (the "extension" envelope:
 * the labs worker). The worker entry gives the renderer backend: `@scenity/render/webgl` or `@scenity/render/webgpu`.
 *
 * The "state" message carries the plugin input as an opaque value. The input schema of the plugin checks it. The core
 * gets only a value that passes, and a value that fails keeps the previous input. The "load", "patch", "pick",
 * "points" and "camera" messages go to the optional methods of the core. A core without them gets a refusal, a null
 * hit or false ("points" does nothing).
 */
import { AnchorClock, epochNow } from "../clock";
import { workerScheduler, type WorkerScopeLike } from "../scheduler";
import type { RenderBackendFactory } from "@scenity/render/types";
import {
  PROTOCOL_VERSION,
  type ExtensionEnvelope,
  type ExtensionMessage,
  type FromWorker,
  type InitMessage,
  type InputSchema,
  type LoadMessage,
  type SceneCoreLike,
  type SceneCoreOptions,
  type ToWorker,
} from "../protocol";

/** The part of a dedicated worker scope that the handler uses. */
export interface SceneScopeLike extends Omit<WorkerScopeLike, "addEventListener" | "postMessage"> {
  addEventListener(type: "message", listener: (event: MessageEvent<ToWorker>) => void): void;
  postMessage(message: FromWorker): void;
}

/**
 * The core of a plugin, the input schema of the plugin and a handler of the messages of an extension.
 * A light object with `safeParse` is sufficient: the worker does not need zod.
 */
export interface SceneWorkerFactory<Input, Core> {
  readonly input: InputSchema<Input>;
  createCore(options: SceneCoreOptions, init: InitMessage): Core;
  handle?(message: ExtensionMessage, core: Core, post: (message: ExtensionMessage) => void): void;
}

type Post = (message: FromWorker) => void;

/** The options of the core from the "init" message: the clock of the worker, its frames and the events as messages. */
function initOptions(
  init: InitMessage,
  clock: AnchorClock,
  scope: WorkerScopeLike,
  backend: RenderBackendFactory,
  post: Post,
): SceneCoreOptions {
  return {
    canvas: init.canvas,
    surface: init.surface,
    tier: init.tier,
    flags: init.flags,
    clock: () => clock.read(epochNow()),
    epoch: () => clock.epoch,
    now: () => performance.now(),
    scheduler: workerScheduler(scope),
    mode: "worker",
    gpuTimer: init.gpuTimer === true,
    backend,
    events: {
      ready: (firstFrameMs) => {
        post({ type: "ready", firstFrameMs });
      },
      anchors: (frame) => {
        post({ type: "anchors", frame });
      },
      hit: (id, kind) => {
        post({ type: "hit", id, kind });
      },
      context: (lost) => {
        post({ type: "context", lost });
      },
      assets: (report) => {
        post({ type: "assetState", report });
      },
      failed: (reason) => {
        post({ type: "backendFailed", reason });
      },
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Give a "load" message to the core: the built assets, then the rest of the message (documents, manifest). */
function applyLoad<Input>(message: LoadMessage, core: SceneCoreLike<Input>, post: Post): void {
  const { id, assets } = message;
  if (assets !== undefined) core.setAssets(assets);
  const load: { -readonly [K in keyof LoadMessage]?: LoadMessage[K] } = { ...message };
  delete load.type;
  delete load.id;
  delete load.assets;
  if (Object.keys(load).length === 0) return;
  const answer = (result: Extract<FromWorker, { type: "loaded" }>["result"]): void => {
    if (id !== undefined) post({ type: "loaded", id, result });
  };
  if (core.load === undefined) answer({ ok: false, reason: "this core takes no documents" });
  else
    core.load(load).then(answer, (error: unknown) => {
      answer({ ok: false, reason: errorText(error) });
    });
}

/** Give a "patch" message to the core. The answer comes after the frame that shows the change. */
function applyPatch<Input>(
  message: Extract<ToWorker, { type: "patch" }>,
  core: SceneCoreLike<Input>,
  post: Post,
): void {
  const { id } = message;
  const answer = (result: Extract<FromWorker, { type: "patched" }>["result"]): void => {
    if (id !== undefined) post({ type: "patched", id, result });
  };
  if (core.patch === undefined) {
    answer({ ok: false, index: 0, reason: "this core takes no documents" });
    return;
  }
  core.patch(message.ops).then(answer, (error: unknown) => {
    answer({ ok: false, index: 0, reason: errorText(error) });
  });
}

/** Give the settings of a "flags" message to the core: the flags and the GPU timer, each when present. */
function applyFlags<Input>(message: Extract<ToWorker, { type: "flags" }>, core: SceneCoreLike<Input>): void {
  if (message.flags !== undefined) core.setFlags(message.flags);
  if (message.gpuTimer !== undefined) core.setGpuTimer(message.gpuTimer);
}

/** Give a message to the core. It returns false after "dispose": the core is disposed. */
function applyMessage<Input, Core extends SceneCoreLike<Input>>(
  message: ToWorker,
  core: Core,
  factory: SceneWorkerFactory<Input, Core>,
  post: Post,
): boolean {
  switch (message.type) {
    case "state": {
      const parsed = factory.input.safeParse(message.input);
      if (parsed.success) core.setInput(parsed.data);
      else console.warn("3D scene: the worker refused a scene input.", parsed.error.issues);
      break;
    }
    case "load":
      applyLoad(message, core, post);
      break;
    case "patch":
      applyPatch(message, core, post);
      break;
    case "surface":
      core.setSurface(message.surface);
      break;
    case "flags":
      applyFlags(message, core);
      break;
    case "tier":
      core.setTier(message.tier);
      break;
    case "scale":
      core.setRenderScale(message.scale);
      break;
    case "pointer":
      core.pointerAt(message.x, message.y, message.kind);
      break;
    case "pick":
      post({ type: "picked", id: message.id, hit: core.pickEntity?.(message.x, message.y, message.options) ?? null });
      break;
    case "points":
      core.setPoints?.(message.refs);
      break;
    case "camera":
      post({ type: "camera", id: message.id, ok: core.useCamera?.(message.name, message.view) ?? false });
      break;
    case "stats":
      post({ type: "stats", id: message.id, stats: core.stats(message.reset) });
      break;
    case "dispose":
      core.dispose();
      return false;
    case "extension":
      factory.handle?.(message.message, core, (inner) => {
        post({ type: "extension", message: inner } satisfies ExtensionEnvelope);
      });
      break;
    case "clock":
    case "init":
      break;
  }
  return true;
}

/** Attach the handler of a render worker to its scope: the factory of the plugin makes the core at "init". */
export function attachSceneWorker<Input, Core extends SceneCoreLike<Input>>(
  scope: SceneScopeLike,
  backend: RenderBackendFactory,
  factory: SceneWorkerFactory<Input, Core>,
): void {
  const clock = new AnchorClock();
  let core: Core | null = null;
  const early: ToWorker[] = [];
  const post = (message: FromWorker): void => {
    scope.postMessage(message);
  };
  const apply = (message: ToWorker): void => {
    if (core !== null && !applyMessage(message, core, factory, post)) core = null;
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    try {
      if (message.type === "clock") {
        clock.set(message.anchor);
        return;
      }
      // The clock anchor of a seek comes with the input of the new time: set the time first, in the same task.
      if (message.type === "state" && message.anchor !== undefined) clock.set(message.anchor);
      if (message.type === "init") {
        if (message.protocol !== PROTOCOL_VERSION) {
          throw new Error(
            `the page speaks protocol ${String(message.protocol)}, the worker ${String(PROTOCOL_VERSION)}`,
          );
        }
        core = factory.createCore(initOptions(message, clock, scope, backend, post), message);
        core.setAssets(message.assets);
        for (const waiting of early.splice(0)) apply(waiting);
        core.start();
        return;
      }
      if (core === null) {
        early.push(message);
        return;
      }
      apply(message);
    } catch (error) {
      post({ type: "error", message: errorText(error) });
    }
  });
}
