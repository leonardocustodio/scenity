// SPDX-License-Identifier: Apache-2.0
/**
 * The dev document core with the WebGPU backend: the options of the WebGPU document core of the runtime, on the main
 * thread (the scene worker uses only WebGL).
 */
import { webgpuDocumentOptions } from "@scenity/runtime/documentCoreGpu";
import type { DocumentBaseOptions } from "@scenity/runtime/documentPlugins";
import { DevDocumentCore } from "./devDocumentCore";

/** A dev document core with the WebGPU backend. */
export function createDocumentCore(options: DocumentBaseOptions): DevDocumentCore {
  return new DevDocumentCore(webgpuDocumentOptions(options));
}
