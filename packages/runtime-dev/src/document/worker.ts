// SPDX-License-Identifier: Apache-2.0
/**
 * The dev scene worker: the generic scene worker of the runtime with the dev document core. It draws the scene
 * documents as the runtime worker does, and it also handles the dev messages (messages.ts): the debug layers and the
 * inspect report. This entry has no plugin loader; the scene page of the editor has its own entry with the project
 * plugins (attachWorker.ts):
 *
 *     import devSceneWorkerUrl from "@scenity/runtime-dev/document/worker?worker&url";
 */
import { attachDevSceneWorker } from "./attachWorker";

attachDevSceneWorker(self);
