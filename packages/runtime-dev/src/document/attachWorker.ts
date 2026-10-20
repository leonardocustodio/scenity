// SPDX-License-Identifier: Apache-2.0
/**
 * The dev scene worker as a function: the generic scene worker of the runtime with the dev document
 * core and the dev messages (messages.ts). The dev entry (worker.ts) gives no plugins. The scene page of the editor has
 * an entry that gives the plugin loader of its build (`virtual:scenity/project-plugins`).
 */
import { createWebGLBackend } from "@scenity/render/webgl";
import type { MetricPlugin } from "@scenity/rules";
import { documentWorkerFactory, pluginSetOf, type WorkerPluginLoader } from "@scenity/runtime/documentMessages";
import type { FromWorker } from "@scenity/runtime/protocol";
import { attachSceneWorker, type SceneScopeLike, type SceneWorkerFactory } from "@scenity/runtime/worker";
import { createDocumentCore } from "./coreGl";
import type { DevDocumentCore } from "./devDocumentCore";
import { handleSceneDevMessage } from "./messages";
import { tapWorkerConsole, type WorkerLogScope } from "./workerLog";

/** The loader of the metric faces of the plugins of a plugin set. */
export type WorkerMetricLoader = (set: string | undefined) => Promise<readonly MetricPlugin[]>;

/**
 * Attach the dev scene worker to a scope; `plugins` loads the project plugins at "init". `metrics` loads the metric
 * faces of the plugins, and the core adds their metric libraries to its rule checks.
 */
export function attachDevSceneWorker(
  scope: SceneScopeLike,
  plugins?: WorkerPluginLoader,
  metrics?: WorkerMetricLoader,
): void {
  const post = (message: FromWorker): void => {
    scope.postMessage(message);
  };
  const base = documentWorkerFactory(createDocumentCore, post, plugins);
  // The dev messages first; the messages of the document core (for example, the selection) go to its handler.
  const factory: SceneWorkerFactory<unknown, DevDocumentCore> = {
    ...base,
    createCore: (options, init) => {
      const core = base.createCore(options, init);
      void metrics?.(pluginSetOf(init)).then(
        (list) => {
          core.useMetrics(list);
        },
        (error: unknown) => {
          console.warn("the metric faces of the plugins do not load", error);
        },
      );
      return core;
    },
    handle: (message, core, reply) => {
      if (!handleSceneDevMessage(message, core, reply)) base.handle?.(message, core, reply);
    },
  };
  // The console lines of the worker go to the Console panel of the page.
  if ("console" in scope)
    tapWorkerConsole(scope as unknown as WorkerLogScope, (message) => post({ type: "extension", message }));
  attachSceneWorker(scope, createWebGLBackend, factory);
}
