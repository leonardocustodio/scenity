// SPDX-License-Identifier: Apache-2.0
/**
 * The asset source over the records of an asset manifest (Manifest 2). It finds an asset by its ID and chooses the
 * file of the LOD tier (else the first LOD, else the first file). It loads that file from its URL. The render worker
 * and the main-thread core use this one source, so both load the same objects.
 *
 * - Models load with the generic asset loader of @scenity/render (`GenericAssetLoader`): the generic GLTFLoader, KTX2
 *   and meshopt without workers, Draco as an optional chunk, the images through `createImageBitmap` in all browsers.
 * - A file of a built record has a size and a SHA-256, and the loader checks them before a parse. A dev record (the
 *   source files of a project) has none, so its files load with no check.
 * - An environment map is a Radiance HDR file: the same bytes path, then the HDR parser of three.js.
 * - A texture is a KTX2 file of a build or an image file of a dev record (`GenericAssetLoader.texture`). An HDR
 *   texture uses the HDR parser. A material is a material document (`*.material.json`), checked with its schema.
 * - The quality tier caps the best level of detail. A tier with no level of its own takes the best level of a
 *   lower tier. The coarser levels after it are the chain of the asset (`lods`): `asset:<id>@<lod tier>` loads one.
 */
import { EquirectangularReflectionMapping, type Object3D, type Texture } from "three";
import { materialDocumentSchema } from "@scenity/scene/schema/material";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { GenericAssetLoader, type GenericFileRef } from "@scenity/render/genericAssets";
import type { TextureSupport } from "@scenity/render/types";
import type { AssetManifest, AssetRecord, SceneDecoders } from "../protocolScene";
import type { AssetKind, AssetSource, MaterialAsset } from "./types";

/** The records of a manifest, the URL of each file and the LOD tier: the asset part of a "load" message. */
export interface ManifestFiles {
  readonly manifest: AssetManifest | null;
  readonly files: Readonly<Record<string, string>>;
  readonly tier: string;
  /** The URLs of the WASM decoders. */
  readonly decoders?: SceneDecoders;
}

/** The quality tiers from low to high. */
const QUALITY_ORDER: readonly string[] = ["low", "medium", "high", "ultra"];

/**
 * The index of the LOD of a quality tier in a record: the LOD of the tier, else the best LOD of a lower quality tier
 * (the tier caps the best level), else the first LOD.
 */
export function recordLevel(record: AssetRecord, tier: string): number {
  const exact = record.lods.findIndex((lod) => lod.tier === tier);
  if (exact >= 0) return exact;
  const wanted = QUALITY_ORDER.indexOf(tier);
  let best = 0;
  let bestRank = -1;
  record.lods.forEach((lod, index) => {
    const rank = QUALITY_ORDER.indexOf(lod.tier);
    if (rank >= 0 && rank <= wanted && rank > bestRank) {
      best = index;
      bestRank = rank;
    }
  });
  return best;
}

/** The file name that a record loads for a tier: the LOD of the tier (`recordLevel`), else the first file. */
export function recordFile(record: AssetRecord, tier: string): string | undefined {
  return record.lods[recordLevel(record, tier)]?.file ?? record.files[0]?.file;
}

/** The coarser LODs after the LOD of a tier, in the order of the record, with no more triangles. */
export function recordChain(record: AssetRecord, tier: string): AssetRecord["lods"] {
  const index = recordLevel(record, tier);
  const first = record.lods[index];
  if (first === undefined) return [];
  return record.lods.slice(index + 1).filter((lod) => lod.file !== first.file && lod.triangles <= first.triangles);
}

/** The asset ID of a reference `asset:<id>`. */
export function assetIdOf(ref: string): string {
  if (!ref.startsWith("asset:")) throw new Error(`"${ref}" is not an asset reference`);
  return ref.slice("asset:".length);
}

/** The material document in the bytes of a material file, checked with its schema. */
export function parseMaterial(ref: string, bytes: ArrayBuffer): MaterialAsset["material"] {
  const parsed = materialDocumentSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(`the material ${ref} is not valid: /${issue?.path.join("/") ?? ""}: ${issue?.message ?? ""}`);
}

export class ManifestAssets implements AssetSource {
  /** The file of each record, by asset ID: its URL, and its size and SHA-256 when the record has them. */
  readonly #refs = new Map<string, GenericFileRef>();
  /** The references of the coarser levels of each model, by asset ID. */
  readonly #chains = new Map<string, string[]>();
  readonly #loader: GenericAssetLoader;
  readonly #hdr = new HDRLoader();

  /** `support` gives the KTX2 target of the backend (`RenderBackend.textureSupport()`), or a promise of it. */
  constructor(
    { manifest, files, tier, decoders }: ManifestFiles,
    support: TextureSupport | Promise<TextureSupport> | null = null,
  ) {
    for (const record of manifest?.records ?? []) {
      if (!this.#add(record.id, record, recordFile(record, tier), files)) continue;
      const chain = recordChain(record, tier).filter((lod) =>
        this.#add(`${record.id}@${lod.tier}`, record, lod.file, files),
      );
      if (chain.length > 0)
        this.#chains.set(
          record.id,
          chain.map((lod) => `asset:${record.id}@${lod.tier}`),
        );
    }
    this.#loader = new GenericAssetLoader({ decoders: decoders ?? {}, support });
  }

  /** The references of the coarser levels of a model, best first. */
  lods(ref: string): readonly string[] {
    return this.#chains.get(assetIdOf(ref)) ?? [];
  }

  /** The URL of the file of an asset. */
  url(ref: string): string {
    return this.#ref(ref).url;
  }

  async load(ref: string, kind: AssetKind): Promise<Object3D | Texture | MaterialAsset> {
    const file = this.#ref(ref);
    if (kind === "model") {
      // The clips go with the scene (`Object3D.animations`): the animator driver reads them from the clone.
      const gltf = await this.#loader.load(file);
      gltf.scene.animations = gltf.animations;
      return gltf.scene;
    }
    if (kind === "material") return { material: parseMaterial(ref, await this.#loader.bytes(file)) };
    if (kind === "texture" && !/\.hdr(?:$|[?#])/i.test(file.url)) return this.#loader.texture(file);
    const texture = this.#hdr.createDataTexture(await this.#loader.bytes(file));
    if (kind === "environment") texture.mapping = EquirectangularReflectionMapping;
    return texture;
  }

  /** Stop the loads that wait (a new manifest replaces this source). */
  dispose(): void {
    this.#loader.dispose();
  }

  /** Keep the file of a record under a key. False when the file has no URL. */
  #add(key: string, record: AssetRecord, file: string | undefined, files: Readonly<Record<string, string>>): boolean {
    const url = file === undefined ? undefined : files[file];
    if (url === undefined) return false;
    const built = record.files.find((entry) => entry.file === file && entry.sha256 !== "");
    this.#refs.set(key, built === undefined ? { url } : { url, bytes: built.bytes, sha256: built.sha256 });
    return true;
  }

  #ref(ref: string): GenericFileRef {
    const file = this.#refs.get(assetIdOf(ref));
    if (file === undefined) throw new Error(`the asset manifest has no ${ref}`);
    return file;
  }
}
