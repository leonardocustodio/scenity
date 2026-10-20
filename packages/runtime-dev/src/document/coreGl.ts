// SPDX-License-Identifier: Apache-2.0
/**
 * The dev document core with the WebGL backend: the options of the WebGL document core of the runtime. The
 * dev scene worker (worker.ts) and the main-thread path of the dev document client (client.ts) make the core here.
 */
import { webglDocumentOptions } from "@scenity/runtime/documentCoreGl";
import type { DocumentBaseOptions } from "@scenity/runtime/documentPlugins";
import { DevDocumentCore } from "./devDocumentCore";

/** A dev document core with the WebGL backend. */
export function createDocumentCore(options: DocumentBaseOptions): DevDocumentCore {
  return new DevDocumentCore(webglDocumentOptions(options));
}
