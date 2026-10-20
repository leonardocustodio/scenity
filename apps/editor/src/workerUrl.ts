// SPDX-License-Identifier: Apache-2.0
/**
 * The URL of the small WebGPU probe of the worker context. Vite builds the worker module as a same-origin file and
 * gives its URL here. The render workers of the scene come from the editor plugin (`EditorPlugin.scene.workers`).
 */
export { default as gpuProbeUrl } from "@scenity/runtime/gpuProbeWorker?worker&url";
