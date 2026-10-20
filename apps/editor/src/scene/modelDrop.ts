// SPDX-License-Identifier: Apache-2.0
/**
 * The promote of a model file that the owner drops into the viewport. The drop makes the model a project asset and an
 * entity, with no Claude prompt:
 *
 * 1. the page finds the point of the surface under the pointer, as the drop of an asset tile does (assetDrop.ts);
 * 2. the dev server imports the file (`assets.import`, scripts/assetApi.ts: the file into `assets/sources`, the
 *    record through the importer, the import and the asset database);
 * 3. the page runs `entity.add` with a `model` component of the new asset at that point: one step of the history, so
 *    ⌘Z removes the entity (the asset files stay). A save writes the scene file; a reload shows the model (a project
 *    with a build gets the source of a new asset, scene/assets.ts).
 *
 * The rights check stays: the record points to `rights/imports.yaml` (licence not known), so the release gate stops
 * the asset until the owner records its rights. The canvas gives the result to a test: `data-drop` (the new entity),
 * `data-promoted` (the new asset ID), `data-promote-rights` (the sentence on the rights) or `data-entity-error`.
 */
import { promotedName } from "@scenity/editor-core";
import { devServerAssets, type AssetSource } from "../assetBrowser/assetClient";
import { dropArgs, type AssetDropParts } from "./assetDrop";

/** The extensions of the model files that a drop promotes. */
export const MODEL_FILES = [".glb", ".gltf", ".fbx", ".obj", ".blend"] as const;

/** What the drop reads of the page: the parts of the asset drop and the asset source of the project. */
export interface ModelDropParts extends AssetDropParts {
  /** The URL of the project folder, with a "/" at the end (`/projects/<name>/`). */
  readonly base: string;
  /** The asset source (a test gives another one). Default: the dev server of the page. */
  readonly source?: AssetSource;
}

/** True when a drag carries files. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

/** The model file of a drop, or null. */
function modelFile(event: DragEvent): File | null {
  const file = event.dataTransfer?.files[0];
  if (file === undefined) return null;
  const name = file.name.toLowerCase();
  return MODEL_FILES.some((ext) => name.endsWith(ext)) ? file : null;
}

/** Promote a dropped model at a canvas point (CSS pixels): the import, then `entity.add`. Returns the entity ID. */
export async function promoteDrop(parts: ModelDropParts, file: File, x: number, y: number): Promise<string> {
  const name = promotedName(file.name);
  // The point first: the camera can move while the import runs.
  const args = await dropArgs(parts, x, y, "", name);
  if (args === null) throw new Error("no place under the pointer");
  const imported = await (parts.source ?? devServerAssets(parts.base)).importFile(file);
  if (!imported.ok) throw new Error(`the import failed: ${imported.reason}`);
  const run = await parts.commands.run("entity.add", { ...args, asset: `asset:${imported.asset.id}` });
  const added = run.ops.find((op) => op.kind === "scene" && op.op.op === "add");
  const id = added?.kind === "scene" && added.op.op === "add" ? added.op.id : "";
  const { canvas } = parts;
  canvas.dataset.promoted = imported.asset.id;
  canvas.dataset.promoteRights = imported.rights?.note ?? "";
  canvas.dataset.drop = id;
  delete canvas.dataset.entityError;
  console.info(
    `promote: ${file.name} is the asset ${imported.asset.id} and the entity ${id}. ${imported.rights?.note ?? ""}`,
  );
  return id;
}

/** Listen to the drops of model files on the canvas; the result stops the listeners. */
export function listenModelDrop(parts: ModelDropParts): () => void {
  const { canvas } = parts;
  const over = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const file = modelFile(event);
    if (file === null) {
      canvas.dataset.entityError = `a drop promotes only a model file (${MODEL_FILES.join(", ")})`;
      return;
    }
    const box = canvas.getBoundingClientRect();
    promoteDrop(parts, file, event.clientX - box.left, event.clientY - box.top).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      canvas.dataset.entityError = reason;
      console.warn(`promote: ${reason}`);
    });
  };
  canvas.addEventListener("dragover", over);
  canvas.addEventListener("drop", drop);
  return () => {
    canvas.removeEventListener("dragover", over);
    canvas.removeEventListener("drop", drop);
  };
}
