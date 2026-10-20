// SPDX-License-Identifier: Apache-2.0
/**
 * The document core with the WebGPU backend: the WebGPU renderer of @scenity/render, the PMREM generator of
 * `three/webgpu` for the environment map and the asset source over the manifest records. The main-thread client
 * (documentClient.ts) makes the core here when the backend is WebGPU; the generic scene worker uses only WebGL.
 *
 * The node library of the backend has the materials of the 3D room (standard and basic). A generic scene also has the
 * physical material of the glTF material extensions and the physical, Lambert and Phong materials of a material asset,
 * so this entry adds their node materials (render/webgpuMaterials.ts).
 */
import { PMREMGenerator, type Renderer } from "three/webgpu";
import { createWebGPUBackend } from "@scenity/render/webgpu";
import { addSceneMaterials } from "@scenity/render/webgpuMaterials";
import type { BackendParams, RenderBackend, SceneRenderer } from "@scenity/render/types";
import { ManifestAssets } from "../scene/manifestAssets";
import { DocumentCore, type DocumentCoreOptions, type EnvironmentMaps } from "./documentCore";
import type { DocumentBaseOptions } from "./documentPlugins";

/** The WebGPU backend with the node materials of the physical, Lambert and Phong materials in its library. */
export function genericWebGPUBackend(params: BackendParams): RenderBackend {
  return addSceneMaterials(createWebGPUBackend(params));
}

/** The PMREM maker of the WebGPU renderer. The core waits for the device before it calls it. */
function webgpuEnvironmentMaps(renderer: SceneRenderer): EnvironmentMaps {
  const pmrem = new PMREMGenerator(renderer as unknown as Renderer);
  return {
    fromEquirectangular: (texture) => pmrem.fromEquirectangular(texture).texture,
    fromCubemap: (texture) => pmrem.fromCubemap(texture).texture,
    dispose: () => {
      pmrem.dispose();
    },
  };
}

/** The options of a document core with the WebGPU backend (the dev tools make a subclass with them). */
export function webgpuDocumentOptions(options: DocumentBaseOptions): DocumentCoreOptions {
  return {
    ...options,
    backend: genericWebGPUBackend,
    assetSource: (manifest, support) => new ManifestAssets(manifest, support),
    environmentMaps: webgpuEnvironmentMaps,
    // The effect passes are a lazy chunk; a scene with no effect never loads it.
    postEffects: () => import("@scenity/render/postWebgpu").then((chunk) => chunk.createWebGPUPost),
  };
}

/** A document core with the WebGPU backend and the plugins of `options.plugins`. */
export function createDocumentCore(options: DocumentBaseOptions): DocumentCore {
  return new DocumentCore(webgpuDocumentOptions(options));
}
