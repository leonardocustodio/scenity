// SPDX-License-Identifier: Apache-2.0
/**
 * The optimizer of the asset build, with glTF Transform. The levels and the codecs come from the project:
 *
 * - models (skinned or static): dedup, prune, weld. Each level of detail (settings.ts) with a ratio under 1 is a
 *   meshoptimizer simplification of the source. KTX2 textures by role (textures.ts), at the texture scale and the
 *   largest edge of the level. Meshopt compression (EXT_meshopt_compression) with quantized attributes
 *   (KHR_mesh_quantization). A model keeps its own clips with all keyframes, because the animator plays them and the
 *   built clip must give the pose of the source at each time. The meshopt filters keep a rotation within 1e-4 rad. A
 *   keyframe resample of the clips of RobotExpressive made the file 5 % larger and the error 5 times larger;
 * - clips: dedup, prune, keyframe resample, meshopt compression.
 *
 * The textures can be PNG, JPEG, WebP or AVIF (images.ts). Each step gets the same input in the same order, so a
 * second run gives the same bytes. The functions also return a "plain" copy (before KTX2 and meshopt) for the glTF
 * validator, which does not decode those extensions. They also return the numbers that the budgets check. The caller
 * gives the triangle budget of the level, the socket names, the generator text and the codecs (OptimizeOptions).
 */
import { Logger, NodeIO, Primitive, type Document, type Node, type Skin, type Texture } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTTextureAVIF,
  EXTTextureWebP,
  KHRMaterialsVariants,
  KHRTextureBasisu,
} from "@gltf-transform/extensions";
import {
  cloneDocument,
  dedup,
  getTextureColorSpace,
  listTextureSlots,
  meshopt,
  prune,
  resample,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { decodeImage, imageFormat } from "./images";
import { DEFAULT_CODECS, GENERATOR, type LodLevel, type TextureCodecs, type TextureRole } from "./settings";
import { encodeKtx2, fit, ktx2Size } from "./textures";

export { GENERATOR } from "./settings";

/** The settings of the optimize step of a model that come from the caller. */
export interface OptimizeOptions {
  /**
   * The triangle budget of the level. A level with a ratio under 1 keeps its ratio of the triangles, or less to stay in
   * this budget.
   */
  readonly triangles?: number;
  /** The names of the socket nodes (empty leaf nodes that the stats list with their parents). */
  readonly socketNames?: readonly string[];
  /** The generator string of the built files (default GENERATOR). */
  readonly generator?: string;
  /** The texture codec of each role (default DEFAULT_CODECS). */
  readonly codecs?: TextureCodecs;
}

let io: NodeIO | null = null;

/** The glTF reader and writer with every extension and the meshopt codec. */
export async function gltfIO(): Promise<NodeIO> {
  if (io !== null) return io;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  return io;
}

function quietDocument(document: Document): Document {
  return document.setLogger(new Logger(Logger.Verbosity.ERROR));
}

export interface ModelStats {
  readonly triangles: number;
  readonly meshes: number;
  readonly primitives: number;
  readonly maxTextureSize: number;
  readonly textures: readonly {
    readonly slots: readonly string[];
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
  }[];
  /** The joints of the first skin, with their parent joints. */
  readonly joints: readonly { readonly name: string; readonly parent: string | null }[];
  readonly skins: number;
  /** The number of different joint lists of the skins (one skeleton: 1; each mesh can have its own skin). */
  readonly skeletons: number;
  /** The morph target names of every mesh (the mesh extras "targetNames" of glTF). */
  readonly morphs: readonly string[];
  readonly sockets: readonly { readonly name: string; readonly parent: string | null }[];
  readonly variants: readonly string[];
  readonly materials: readonly string[];
  readonly nodes: readonly string[];
  /** The largest number of non-zero bone weights on one vertex. */
  readonly maxInfluences: number;
}

export interface ClipStats {
  readonly animations: readonly string[];
  readonly duration: number;
  readonly channels: readonly { readonly node: string; readonly path: string }[];
  readonly joints: readonly { readonly name: string; readonly parent: string | null }[];
}

export interface Optimized<S> {
  readonly glb: Uint8Array;
  readonly plain: Uint8Array;
  readonly stats: S;
}

function triangleCount(primitive: Primitive): number {
  if (primitive.getMode() !== Primitive.Mode.TRIANGLES) return 0;
  const indices = primitive.getIndices();
  const count = indices !== null ? indices.getCount() : (primitive.getAttribute("POSITION")?.getCount() ?? 0);
  return Math.floor(count / 3);
}

function parentName(node: Node): string | null {
  return node.getParentNode()?.getName() ?? null;
}

function maxInfluences(document: Document): number {
  let max = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (!semantic.startsWith("WEIGHTS_")) continue;
        const weights = primitive.getAttribute(semantic);
        if (weights === null) continue;
        const element: number[] = [];
        const sets = primitive.listSemantics().filter((name) => name.startsWith("WEIGHTS_")).length;
        for (let i = 0; i < weights.getCount(); i++) {
          weights.getElement(i, element);
          const used = element.filter((w) => w > 1e-4).length;
          max = Math.max(max, semantic === "WEIGHTS_0" ? used + (sets - 1) * 4 : used);
        }
      }
    }
  }
  return max;
}

/** The role of a texture of a model: a normal map, a colour (sRGB) or other linear data. */
function textureRole(texture: Texture): TextureRole {
  if (listTextureSlots(texture).includes("normalTexture")) return "normal";
  return getTextureColorSpace(texture) === "srgb" ? "color" : "data";
}

/** The numbers of a model that the validator and the manifest need. */
export function modelStats(document: Document, socketNames: readonly string[] = []): ModelStats {
  const root = document.getRoot();
  let triangles = 0;
  let primitives = 0;
  const morphs = new Set<string>();
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles += triangleCount(primitive);
      primitives += 1;
      // glTF Transform reads the mesh extras "targetNames" into the names of the targets.
      for (const target of primitive.listTargets()) morphs.add(target.getName());
    }
  }
  const textures = root.listTextures().map((texture) => {
    const image = texture.getImage();
    let size = { width: 0, height: 0 };
    if (image !== null && texture.getMimeType() === "image/ktx2") size = ktx2Size(image);
    else if (image !== null && texture.getMimeType() === "image/png") size = decodePngSize(image);
    return { slots: listTextureSlots(texture), mimeType: texture.getMimeType(), ...size };
  });
  const skins = root.listSkins();
  // The parent of a joint is the parent joint; the root joint can sit under a node of the armature object.
  const jointsOf = (skin: Skin): { name: string; parent: string | null }[] => {
    const names = new Set(skin.listJoints().map((joint) => joint.getName()));
    return skin.listJoints().map((joint) => {
      const parent = parentName(joint);
      return { name: joint.getName(), parent: parent !== null && names.has(parent) ? parent : null };
    });
  };
  const joints = skins[0] === undefined ? [] : jointsOf(skins[0]);
  const key = (skin: Skin): string =>
    jointsOf(skin)
      .map((joint) => `${joint.name}<${joint.parent ?? ""}`)
      .join(",");
  const skeletons = new Set(skins.map(key)).size;
  const socketSet = new Set(socketNames);
  const sockets = root
    .listNodes()
    .filter((node) => socketSet.has(node.getName()))
    .map((node) => ({ name: node.getName(), parent: parentName(node) }));
  const variantsExtension = root
    .listExtensionsUsed()
    .find((extension) => extension.extensionName === KHRMaterialsVariants.EXTENSION_NAME) as
    KHRMaterialsVariants | undefined;
  const variants = (variantsExtension?.listVariants() ?? []).map((variant) => variant.getName());
  return {
    triangles,
    meshes: root.listMeshes().length,
    primitives,
    maxTextureSize: Math.max(0, ...textures.map((texture) => Math.max(texture.width, texture.height))),
    textures,
    joints,
    skins: skins.length,
    skeletons,
    morphs: [...morphs],
    sockets,
    variants,
    materials: root.listMaterials().map((material) => material.getName()),
    nodes: root.listNodes().map((node) => node.getName()),
    maxInfluences: maxInfluences(document),
  };
}

function decodePngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The edge of a texture on a level: the texture scale of the level, then the largest edge of its role. */
function levelEdge(sourceSize: number, level: LodLevel, role: TextureRole): number {
  const scaled = level.textureScale < 1 ? Math.max(1, Math.floor(sourceSize * level.textureScale)) : sourceSize;
  return Math.min(level.maxTextureSize[role], scaled);
}

const IMAGE_EXTENSIONS: readonly string[] = [EXTTextureWebP.EXTENSION_NAME, EXTTextureAVIF.EXTENSION_NAME];

async function compressTextures(document: Document, level: LodLevel, codecs: TextureCodecs): Promise<void> {
  const textures = document.getRoot().listTextures();
  for (const texture of textures) {
    const image = texture.getImage();
    if (image === null || texture.getMimeType() === "image/ktx2") continue;
    if (imageFormat(image) === null) {
      const type = texture.getMimeType();
      throw new Error(`texture ${texture.getName()}: ${type} is not supported; use PNG, JPEG, WebP or AVIF`);
    }
    const role = textureRole(texture);
    const source = await decodeImage(image);
    const target = levelEdge(Math.max(source.width, source.height), level, role);
    const ktx2 = await encodeKtx2(fit(source, target, 0), codecs[role], role);
    texture.setImage(ktx2).setMimeType("image/ktx2").setURI("");
  }
  // At this point, each texture is KTX2, so the extensions of the WebP and AVIF images have no use.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (IMAGE_EXTENSIONS.includes(extension.extensionName)) extension.dispose();
  }
  if (textures.length > 0) document.createExtension(KHRTextureBasisu).setRequired(true);
}

/** The ratio of a level: its own ratio, or less when that is still over the triangle budget of the level. */
function lodRatio(triangles: number, ratio: number, budget: number | undefined): number {
  if (triangles === 0) return 1;
  return budget === undefined ? ratio : Math.min(ratio, (budget * 0.95) / triangles);
}

/** Optimize a model for one level of detail. */
export async function optimizeModel(
  input: Uint8Array,
  level: LodLevel,
  options: OptimizeOptions,
): Promise<Optimized<ModelStats>> {
  const generator = options.generator ?? GENERATOR;
  const socketNames = options.socketNames ?? [];
  const reader = await gltfIO();
  const document = quietDocument(await reader.readBinary(input));
  // Sockets are empty leaf nodes: prune must keep them.
  // keepUniqueNames: two materials can have the same textures and differ only by name. A renderer can find a material
  // by its name, so dedup must not merge the two.
  await document.transform(
    dedup({ keepUniqueNames: true }),
    prune({ keepLeaves: true, keepAttributes: false }),
    weld(),
  );
  if (level.ratio < 1) {
    const ratio = lodRatio(modelStats(document).triangles, level.ratio, options.triangles);
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: true }));
  }
  document.getRoot().getAsset().generator = generator;
  const plain = await reader.writeBinary(cloneDocument(document));
  await compressTextures(document, level, options.codecs ?? DEFAULT_CODECS);
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  document.getRoot().getAsset().generator = generator;
  const glb = await reader.writeBinary(document);
  return { glb, plain, stats: modelStats(document, socketNames) };
}

/** The numbers of a clip. */
export function clipStats(document: Document): ClipStats {
  const root = document.getRoot();
  let duration = 0;
  const channels: { node: string; path: string }[] = [];
  for (const animation of root.listAnimations()) {
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput();
      if (input !== null) duration = Math.max(duration, input.getMax([])[0] ?? 0);
    }
    for (const channel of animation.listChannels()) {
      channels.push({ node: channel.getTargetNode()?.getName() ?? "", path: channel.getTargetPath() ?? "" });
    }
  }
  const joints = root.listNodes().map((node) => ({ name: node.getName(), parent: parentName(node) }));
  return { animations: root.listAnimations().map((animation) => animation.getName()), duration, channels, joints };
}

/** Optimize a clip (one file for each clip). */
export async function optimizeClip(input: Uint8Array, generator = GENERATOR): Promise<Optimized<ClipStats>> {
  const reader = await gltfIO();
  const document = quietDocument(await reader.readBinary(input));
  await document.transform(dedup(), resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }));
  document.getRoot().getAsset().generator = generator;
  const plain = await reader.writeBinary(cloneDocument(document));
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  document.getRoot().getAsset().generator = generator;
  const glb = await reader.writeBinary(document);
  return { glb, plain, stats: clipStats(document) };
}
