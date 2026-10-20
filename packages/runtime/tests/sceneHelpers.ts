// SPDX-License-Identifier: Apache-2.0
/** Shared helpers of the scene builder tests: the showroom document, a fake asset source and a seeded random. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Object3D } from "three";
import { readDocument, type SceneDocument } from "@scenity/scene";
import type { AssetKind, AssetSource, AssetValue } from "../src";
import { ASSET_MANIFEST_FORMAT, type AssetLod, type AssetManifest, type AssetRecord } from "../src/manifest";

export const SHOWROOM = join(import.meta.dir, "../../../samples/showroom/scenes/main.scene.json");

export function showroom(): SceneDocument {
  const result = readDocument(readFileSync(SHOWROOM, "utf8"), "scene");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The resources of one fake model, with a flag for each dispose. */
export interface FakeModel {
  readonly root: Group;
  readonly geometry: BoxGeometry;
  readonly material: MeshStandardMaterial;
  readonly texture: Texture;
  readonly disposed: { geometry: boolean; material: boolean; texture: boolean };
}

/** A fake asset source: each model is a group with one box mesh, a material "wood" and a texture. */
export class FakeAssets implements AssetSource {
  readonly loads = new Map<string, number>();
  readonly released: string[] = [];
  readonly models = new Map<string, FakeModel[]>();
  /** The references that fail to load. */
  readonly failing = new Set<string>();

  load(ref: string, kind: AssetKind): Promise<AssetValue> {
    this.loads.set(ref, (this.loads.get(ref) ?? 0) + 1);
    if (this.failing.has(ref)) return Promise.reject(new Error(`no asset ${ref}`));
    if (kind !== "model") return Promise.resolve(new Texture());
    const model = fakeModel(ref);
    this.models.set(ref, [...(this.models.get(ref) ?? []), model]);
    return Promise.resolve(model.root);
  }

  release(ref: string): void {
    this.released.push(ref);
  }

  /** The last model that the source made for a reference. */
  model(ref: string): FakeModel {
    const list = this.models.get(ref);
    const model = list?.[list.length - 1];
    if (model === undefined) throw new Error(`no model for ${ref}`);
    return model;
  }

  totalLoads(): number {
    return [...this.loads.values()].reduce((sum, count) => sum + count, 0);
  }
}

function fakeModel(ref: string): FakeModel {
  const geometry = new BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0);
  const texture = new Texture();
  const material = new MeshStandardMaterial({ name: "wood", map: texture });
  const root = new Group();
  root.name = ref;
  const mesh = new Mesh(geometry, material);
  mesh.name = "body";
  root.add(mesh);
  const disposed = { geometry: false, material: false, texture: false };
  geometry.addEventListener("dispose", () => (disposed.geometry = true));
  material.addEventListener("dispose", () => (disposed.material = true));
  texture.addEventListener("dispose", () => (disposed.texture = true));
  return { root, geometry, material, texture, disposed };
}

/** A Manifest 2 record of a model with one file per LOD (or one file without LODs), with no sizes and no hashes. */
export function modelRecord(id: string, files: readonly string[], lods: readonly AssetLod[] = []): AssetRecord {
  const list = files.map((file) => ({ file, bytes: 0, sha256: "" }));
  return { id, kind: "model", lods, files: list, bytes: 0, sha256: "", stats: {}, tags: [] };
}

/** A Manifest 2 manifest of records. */
export function manifestOf(records: readonly AssetRecord[]): AssetManifest {
  return { format: ASSET_MANIFEST_FORMAT, tiers: ["high", "low"], records };
}

/** A seeded random generator (mulberry32): the same seed gives the same numbers on each run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first mesh under an object. */
export function firstMesh(object: Object3D | null | undefined): Mesh | undefined {
  let found: Mesh | undefined;
  object?.traverse((node) => {
    if (found === undefined && (node as Partial<Mesh>).isMesh === true) found = node as Mesh;
  });
  return found;
}
