// SPDX-License-Identifier: Apache-2.0
/**
 * The generic scene worker: the module worker that draws the scene documents of a project with the document core and
 * the WebGL backend. The "load" and "patch" messages control the scene builder in the worker. The worker of a plugin
 * core is a separate entry, so its size does not change. Load it with a same-origin URL, never from a Blob URL (the CSP has worker-src 'self' and Trusted Types):
 *
 *     import sceneWorkerUrl from "@scenity/runtime/sceneWorker?worker&url";
 */
import { attachDocumentWorker } from "./documentWorker";

// This entry has no plugin loader. The player has an entry with the plugins of its build.
attachDocumentWorker(self);
