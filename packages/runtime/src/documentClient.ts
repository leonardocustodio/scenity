// SPDX-License-Identifier: Apache-2.0
/**
 * The page client of the document core. It uses the generic scene worker when the browser can run it, else the
 * document core on the main thread (a separate chunk with three.js). Both paths take the same calls: `load` (the
 * documents and the asset manifest), `patch` (the scene ops), `pickEntity`, `useCamera` (the "camera" message of the
 * protocol), the surface and the flags.
 *
 *     import sceneWorkerUrl from "@scenity/runtime/sceneWorker?worker&url";
 *     const client = await createDocumentClient(canvas, { workerUrl: sceneWorkerUrl, getSimMs: () => null, ... });
 *     await client.load({ documents: { scene }, manifest });
 *     await client.useCamera("front");
 *
 * The `plugins` option gives the project plugins to the main-thread core. A worker loads the plugins of its own
 * build (worker/documentMessages.ts): the page names the set in the "init" message (`init: { plugins: "<set>" }`).
 */
import { createSceneClient, type SceneClient, type SceneClientOptions, type SceneLink } from "./client";
import type { DocumentCore } from "./core/documentCore";
import type { RuntimePlugin } from "./plugins/types";
import type { InputEvent } from "@scenity/scene/input";
import type { InputsMessage, SelectMessage } from "./worker/documentMessages";

export type DocumentClient = SceneClient<unknown>;

export interface DocumentClientOptions extends Omit<SceneClientOptions<DocumentCore>, "gpuWorkerUrl"> {
  /** Load the project plugins of the main-thread core. Absent: no plugins. The worker does not call it. */
  readonly plugins?: () => Promise<readonly RuntimePlugin[]>;
}

/** The plugins of the main-thread core of a client: the promise of the loader, or no field. */
export function mainPlugins(options: DocumentClientOptions): { plugins?: Promise<readonly RuntimePlugin[]> } {
  return options.plugins === undefined ? {} : { plugins: options.plugins() };
}

/**
 * Create the client of the document core on a canvas. The generic scene worker is WebGL only: a WebGPU choice (the
 * `backend` option) draws with the WebGPU core on the main thread when the page gives no worker URL. Each backend has
 * its own chunk (literal dynamic imports).
 */
export function createDocumentClient(
  canvas: HTMLCanvasElement,
  options: DocumentClientOptions,
): Promise<DocumentClient> {
  return createSceneClient<unknown, DocumentCore>(canvas, options, async (backend) => {
    const entry = await (backend === "webgpu" ? import("./core/documentCoreGpu") : import("./core/documentCoreGl"));
    return (base) => Promise.resolve(entry.createDocumentCore({ ...base, ...mainPlugins(options) }));
  });
}

/**
 * The selection of the outline over the channel of a client: a "select" extension message to the generic
 * scene worker, or a call of the core on the main thread. Give it the link of the `link` option.
 */
export function selectionOf(link: SceneLink<DocumentCore>): (ids: readonly string[]) => void {
  if (link.mode === "main") return (ids) => link.core.select(ids);
  return (ids) => {
    link.send({ type: "select", ids: [...ids] } satisfies SelectMessage);
  };
}

/**
 * The input events of the play mode over the channel of a client: an "inputs" extension message to the generic scene
 * worker, or a call of the core on the main thread. `replace` removes the events that came before them.
 */
export function inputsOf(link: SceneLink<DocumentCore>): (events: readonly InputEvent[], replace: boolean) => void {
  if (link.mode === "main") return (events, replace) => link.core.setInputs(events, replace);
  return (events, replace) => {
    link.send({ type: "inputs", events: [...events], replace } satisfies InputsMessage);
  };
}
