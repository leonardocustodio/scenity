// SPDX-License-Identifier: Apache-2.0
/**
 * The generic scene worker as a function: the document core with the WebGL backend on a worker scope.
 * The worker entry of the runtime (sceneWorker.ts) gives no plugins. A worker entry of a host gives the plugin loader
 * of its build, for example the player:
 *
 *     import { loadPlugins } from "virtual:scenity/plugins";
 *     attachDocumentWorker(self, (set) => loadPlugins(set));
 */
import { createWebGLBackend } from "@scenity/render/webgl";
import { createDocumentCore } from "../core/documentCoreGl";
import type { FromWorker } from "../protocol";
import { attachSceneWorker, type SceneScopeLike } from "./handler";
import { documentWorkerFactory, type WorkerPluginLoader } from "./documentMessages";

/** Attach the generic scene worker to a scope. `plugins` loads the project plugins at "init". */
export function attachDocumentWorker(scope: SceneScopeLike, plugins?: WorkerPluginLoader): void {
  // The audio frames of the core go to the page in "audio" messages.
  const post = (message: FromWorker): void => {
    scope.postMessage(message);
  };
  attachSceneWorker(scope, createWebGLBackend, documentWorkerFactory(createDocumentCore, post, plugins));
}
