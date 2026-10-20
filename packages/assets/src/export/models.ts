// SPDX-License-Identifier: Apache-2.0
/**
 * The models of the glTF export. Each `model` component copies the nodes of the default scene of its model
 * file under the entity node, with the meshes, materials, textures, skins and animations of the file. The material
 * overrides of the component change the copied materials by name. The export reads the current import of the model,
 * else its glTF or GLB source (build/projectInputs.ts), so the textures stay PNG, JPEG or WebP for other tools.
 */
import { Logger, type Document, type Material, type Node, type Scene } from "@gltf-transform/core";
import { mergeDocuments } from "@gltf-transform/functions";
import type { ModelValue } from "@scenity/scene";
import { gltfIO } from "../build/optimize";
import { linearColour } from "./math";

type MaterialOverride = NonNullable<ModelValue["materials"]>[string];

/** The model files by asset ID: a reader gives the GLB bytes of a model asset, or null when it has none. */
export type ModelReader = (assetId: string) => Promise<Uint8Array | null>;

/** The parsed model documents by asset ID, so that each file reads one time. */
export class ModelFiles {
  private readonly documents = new Map<string, Promise<Document | null>>();

  constructor(private readonly read: ModelReader) {}

  /** The document of a model asset, or null when it has no GLB bytes. */
  get(assetId: string): Promise<Document | null> {
    let found = this.documents.get(assetId);
    if (found === undefined) {
      found = this.load(assetId);
      this.documents.set(assetId, found);
    }
    return found;
  }

  private async load(assetId: string): Promise<Document | null> {
    const bytes = await this.read(assetId);
    if (bytes === null) return null;
    const doc = await (await gltfIO()).readBinary(bytes);
    return doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  }
}

function applyOverride(material: Material, override: MaterialOverride): void {
  const [, , , alpha] = material.getBaseColorFactor();
  if (override.colour !== undefined) material.setBaseColorFactor([...linearColour(override.colour), alpha]);
  if (override.roughness !== undefined) material.setRoughnessFactor(override.roughness);
  if (override.metalness !== undefined) material.setMetallicFactor(override.metalness);
  if (override.opacity !== undefined) {
    const [r, g, b] = material.getBaseColorFactor();
    material.setBaseColorFactor([r, g, b, override.opacity]);
    if (override.opacity < 1) material.setAlphaMode("BLEND");
  }
}

/**
 * Copy the nodes of the default scene of `source` under `parent` in `target`. Each call makes new copies. The dedup
 * step of the export then shares the same meshes and textures. Gives the names of the copied meshes.
 */
export function mountModel(target: Document, source: Document, parent: Node, value: ModelValue): string[] {
  const root = source.getRoot();
  const sourceScene = root.getDefaultScene() ?? root.listScenes()[0];
  const map = mergeDocuments(target, source);
  const copied = sourceScene === undefined ? undefined : (map.get(sourceScene) as Scene | undefined);
  const nodes = copied?.listChildren() ?? [];
  for (const node of nodes) parent.addChild(node);
  for (const scene of root.listScenes()) map.get(scene)?.dispose();
  const overrides = value.materials ?? {};
  for (const material of root.listMaterials()) {
    const override = overrides[material.getName()];
    const copy = map.get(material) as Material | undefined;
    if (override !== undefined && copy !== undefined) applyOverride(copy, override);
  }
  const meshes: string[] = [];
  for (const node of nodes) {
    node.traverse((child) => {
      const mesh = child.getMesh();
      if (mesh !== null) meshes.push(mesh.getName());
    });
  }
  return meshes;
}
