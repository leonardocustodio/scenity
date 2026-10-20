// SPDX-License-Identifier: Apache-2.0
/**
 * The document core with the WebGL backend: the classic WebGLRenderer, the PMREM generator of three.js for the
 * environment map and the asset source over the manifest records. The generic scene worker (worker/sceneWorker.ts) and
 * the main-thread client (documentClient.ts) make the core here, so both paths run the same code. The WebGPU entry is
 * documentCoreGpu.ts.
 */
import { PMREMGenerator, type WebGLRenderer } from "three";
import { createWebGLBackend } from "@scenity/render/webgl";
import type { SceneRenderer } from "@scenity/render/types";
import { ManifestAssets } from "../scene/manifestAssets";
import { DocumentCore, type DocumentCoreOptions, type EnvironmentMaps } from "./documentCore";
import type { DocumentBaseOptions } from "./documentPlugins";

/** The PMREM maker of the WebGL renderer. */
function webglEnvironmentMaps(renderer: SceneRenderer): EnvironmentMaps {
  const pmrem = new PMREMGenerator(renderer as WebGLRenderer);
  return {
    fromEquirectangular: (texture) => pmrem.fromEquirectangular(texture).texture,
    fromCubemap: (texture) => pmrem.fromCubemap(texture).texture,
    dispose: () => {
      pmrem.dispose();
    },
  };
}

/** The options of a document core with the WebGL backend (the dev tools make a subclass with them). */
export function webglDocumentOptions(options: DocumentBaseOptions): DocumentCoreOptions {
  return {
    ...options,
    backend: createWebGLBackend,
    assetSource: (manifest, support) => new ManifestAssets(manifest, support),
    environmentMaps: webglEnvironmentMaps,
    // The effect passes are a lazy chunk; a scene with no effect never loads it.
    postEffects: () => import("@scenity/render/postWebgl").then((chunk) => chunk.createWebGLPost),
  };
}

/** A document core with the WebGL backend and the plugins of `options.plugins`. */
export function createDocumentCore(options: DocumentBaseOptions): DocumentCore {
  return new DocumentCore(webglDocumentOptions(options));
}
