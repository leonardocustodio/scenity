// SPDX-License-Identifier: Apache-2.0
/**
 * The glTF writer of a scene document: one glTF document with one node for each entity, in the tree and the
 * order of the scene. The node of an entity has the entity ID as its name, the local transform of the `transform`
 * component and `extras` with the entity ID, the name, the tags and the component IDs. The components become child
 * nodes `<entity>:<component>` (shape, model, light, camera) and `<entity>#<socket>` (the socket points). A
 * `visibility` value of false becomes KHR_node_visibility. The axes and the units of a scene are the axes and units
 * of glTF (metres, Y up), so the export does not convert them.
 *
 * The writer reads no file: the caller gives the scene with each prefab expanded, and the model files.
 */
import { Document, type Buffer, type Node } from "@gltf-transform/core";
import { KHRLightsPunctual, KHRNodeVisibility } from "@gltf-transform/extensions";
import { dedup, prune, unpartition } from "@gltf-transform/functions";
import {
  cameraSchema,
  childrenOf,
  lightSchema,
  localTransform,
  modelSchema,
  parseRef,
  shapeSchema,
  socketSchema,
  visibilitySchema,
  type SceneDocument,
} from "@scenity/scene";
import type { z } from "zod";
import { gltfIO } from "../build/optimize";
import { cameraNode, lightNode, socketNodes } from "./components";
import { mountModel, type ModelFiles } from "./models";
import { shapeMesh } from "./shapes";

/** The options of the writer. */
export interface WriteOptions {
  /** The `asset.generator` text of the glTF file (default `Scenity`). */
  readonly generator?: string;
}

/** The result of the writer: the glTF document, the mesh names of each model entity and the warnings. */
export interface WrittenScene {
  readonly document: Document;
  /** The mesh names that each `model` component copied, by entity ID. */
  readonly models: Readonly<Record<string, readonly string[]>>;
  readonly warnings: readonly string[];
}

interface WriteContext {
  readonly doc: Document;
  /** The one buffer of the shape meshes; the models bring their own buffers until `unpartition`. */
  readonly buffer: Buffer;
  readonly scene: SceneDocument;
  readonly files: ModelFiles;
  readonly lights: KHRLightsPunctual;
  readonly visibility: KHRNodeVisibility;
  readonly models: Record<string, string[]>;
  readonly warnings: string[];
}

/** The parsed value of a component, or undefined with a warning when the value is bad. */
function component<S extends z.ZodType>(
  ctx: WriteContext,
  id: string,
  name: string,
  schema: S,
): z.infer<S> | undefined {
  const value = ctx.scene.entities[id]?.components[name];
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  ctx.warnings.push(`${id}: the ${name} component is not valid; the export skips it`);
  return undefined;
}

async function addModel(ctx: WriteContext, id: string, node: Node): Promise<void> {
  const model = component(ctx, id, "model", modelSchema);
  if (model === undefined) return;
  const ref = parseRef(model.asset);
  const source = ref?.kind === "asset" ? await ctx.files.get(ref.id) : null;
  if (source === null) {
    ctx.warnings.push(`${id}: the model ${model.asset} has no glTF file; the export skips it`);
    return;
  }
  const holder = ctx.doc.createNode(`${id}:model`).setExtras({ entity: id, component: "model", asset: model.asset });
  ctx.models[id] = mountModel(ctx.doc, source, holder, model);
  node.addChild(holder);
}

async function addComponents(ctx: WriteContext, id: string, node: Node): Promise<void> {
  const { doc, scene } = ctx;
  if (component(ctx, id, "visibility", visibilitySchema)?.visible === false)
    node.setExtension("KHR_node_visibility", ctx.visibility.createVisibility().setVisible(false));
  const shape = component(ctx, id, "shape", shapeSchema);
  if (shape !== undefined) {
    if (shape.material !== undefined) ctx.warnings.push(`${id}: the export has no material asset of a shape`);
    const mesh = shapeMesh(doc, ctx.buffer, `${id}:shape`, shape);
    node.addChild(doc.createNode(`${id}:shape`).setMesh(mesh).setExtras({ entity: id, component: "shape" }));
  }
  await addModel(ctx, id, node);
  const light = component(ctx, id, "light", lightSchema);
  if (light !== undefined)
    node.addChild(lightNode(doc, ctx.lights, scene, id, light, (message) => ctx.warnings.push(message)));
  const camera = component(ctx, id, "camera", cameraSchema);
  if (camera !== undefined) node.addChild(cameraNode(doc, scene, id, camera));
  const socket = component(ctx, id, "socket", socketSchema);
  for (const child of socket === undefined ? [] : socketNodes(doc, id, socket)) node.addChild(child);
}

async function entityNode(ctx: WriteContext, id: string): Promise<Node> {
  const entity = ctx.scene.entities[id];
  if (entity === undefined) throw new Error(`no entity ${id}`);
  const local = localTransform(entity);
  const node = ctx.doc
    .createNode(id)
    .setTranslation(local.position)
    .setRotation(local.rotation)
    .setScale(local.scale)
    .setExtras({
      entity: id,
      ...(entity.name === undefined ? {} : { name: entity.name }),
      tags: [...(entity.tags ?? [])],
      components: Object.keys(entity.components).sort(),
    });
  await addComponents(ctx, id, node);
  for (const child of childrenOf(ctx.scene.entities, id)) node.addChild(await entityNode(ctx, child));
  return node;
}

/** Write the glTF document of a scene. Each prefab of the scene must be expanded. */
export async function writeSceneGltf(
  scene: SceneDocument,
  files: ModelFiles,
  options: WriteOptions = {},
): Promise<WrittenScene> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = options.generator ?? "Scenity";
  const ctx: WriteContext = {
    doc,
    buffer: doc.createBuffer(),
    scene,
    files,
    lights: doc.createExtension(KHRLightsPunctual),
    visibility: doc.createExtension(KHRNodeVisibility),
    models: {},
    warnings: [],
  };
  const root = doc
    .createScene(scene.name ?? scene.id)
    .setExtras({ scene: scene.id, ...(scene.environment === undefined ? {} : { environment: scene.environment }) });
  doc.getRoot().setDefaultScene(root);
  for (const id of childrenOf(scene.entities, null)) root.addChild(await entityNode(ctx, id));
  // The models bring their own buffers: one buffer is a rule of GLB. Dedup shares the meshes of two copies again.
  await doc.transform(
    dedup({ keepUniqueNames: true }),
    prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
    unpartition(),
  );
  // An extension with no user stays out of `extensionsUsed`.
  const nodes = doc.getRoot().listNodes();
  for (const extension of [ctx.lights, ctx.visibility]) {
    if (!nodes.some((node) => node.getExtension(extension.extensionName) !== null)) extension.dispose();
  }
  return { document: doc, models: ctx.models, warnings: ctx.warnings };
}

/** The GLB bytes of a written scene. */
export async function sceneGlb(written: WrittenScene): Promise<Uint8Array> {
  return (await gltfIO()).writeBinary(written.document);
}
