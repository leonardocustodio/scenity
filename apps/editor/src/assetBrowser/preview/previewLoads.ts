// SPDX-License-Identifier: Apache-2.0
/**
 * The loads of the live previews of the asset inspector. An asset loads by its ID through
 * the asset manifest of the project, as on the scene page and the still page: the built file of the "high" tier when
 * the project has a build, else the source file. A material gets the texture assets of its maps.
 */
import type { Material, Object3D, Texture, WebGLRenderer } from "three";
import { ManifestAssets } from "@scenity/runtime/manifestAssets";
import { makeMaterial } from "@scenity/runtime/materials";
import { readAssets } from "../../scene/assets";
import { DECODERS } from "../../scene/decoders";
import type { PreviewLoads } from "./previewScenes";

/**
 * The loads of the asset `id` of the project at `base` (the URL of the project folder, with a "/" at the end).
 * `tier` selects a level of detail of the build (default "high").
 */
export function previewLoads(base: string, id: string, tier = "high"): PreviewLoads {
  const ref = `asset:${id}`;
  const source = async (renderer: WebGLRenderer): Promise<ManifestAssets> => {
    const { manifest, files, decoders } = await readAssets(base, null, DECODERS);
    return new ManifestAssets({ manifest, files, tier, decoders }, { renderer });
  };
  return {
    model: async (renderer) => (await (await source(renderer)).load(ref, "model")) as Object3D,
    environment: async (renderer) => (await (await source(renderer)).load(ref, "environment")) as Texture,
    async material(renderer): Promise<Material> {
      const assets = await source(renderer);
      const loaded = await assets.load(ref, "material");
      if (!("material" in loaded)) throw new Error(`${ref} is not a material`);
      const doc = loaded.material;
      const textures = new Map<string, Texture>();
      for (const map of Object.values(doc.maps ?? {})) {
        const texture = map.texture;
        if (!textures.has(texture)) {
          textures.set(texture, (await assets.load(texture, "texture")) as Texture);
        }
      }
      return makeMaterial(doc, textures);
    },
  };
}
