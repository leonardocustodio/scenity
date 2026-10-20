// SPDX-License-Identifier: Apache-2.0
/**
 * The drop of an asset tile into the viewport. A tile of the asset browser drags `asset:<id>` and the asset name
 * (assetBrowser/assetTypes.ts). On the drop, the page picks the entity under the pointer. It reads the surfaces from
 * the own boxes of the inspect report, as the surface snap does. Then it runs `entity.add` with a `model` component of
 * the asset at the point of the surface under the pointer (`assetDropPoint` of `@scenity/editor-core`). The add is one
 * step of the history, and the page selects the new entity. `data-drop` on the canvas gives the ID of the last new
 * entity (a test waits for it). A refusal goes to `data-entity-error`.
 */
import { assetDropPoint, surfacesOf } from "@scenity/editor-core";
import type { PickHit } from "@scenity/runtime/protocol";
import { ASSET_DRAG_TYPE, ASSET_NAME_DRAG_TYPE, ASSET_KIND_DRAG_TYPE } from "../assetBrowser/assetTypes";
import { pageView, viewRay, type EditorPose } from "./dragMath";
import { boxesOf, type InspectPort } from "./gizmo/freeDrag";
import type { SceneCommands } from "./hierarchy/sceneCommands";
import { MESH_PART_PREFIX } from "@scenity/scene/components";
import type { ScenePageEditor } from "./sceneEditor";
import { mainViewBox } from "./viewport/mainView";

/** What the drop reads of the page. */
export interface AssetDropParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly commands: SceneCommands;
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The name of the camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera while it draws, else null: the drop uses the camera that draws. */
  editorView?(): EditorPose | null;
  readonly inspect?: InspectPort;
}

/** True when a drag carries an asset of the asset browser. */
function carriesAsset(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(ASSET_DRAG_TYPE) === true;
}

/** The arguments of `entity.add` for a drop at a canvas point (CSS pixels), or null with no camera or no point. */
export async function dropArgs(
  parts: AssetDropParts,
  x: number,
  y: number,
  asset: string,
  name: string,
): Promise<Record<string, string | number> | null> {
  const doc = parts.editor.doc;
  const view = pageView(doc, parts);
  if (view === null) return null;
  const box = mainViewBox(parts.canvas);
  const ray = viewRay(view, x, y, box.width, box.height);
  const [hit, report] = await Promise.all([parts.pick(x, y), parts.inspect?.().catch(() => null) ?? null]);
  const surfaces = surfacesOf(boxesOf(report ?? null), new Set());
  const place = assetDropPoint(ray, surfaces, hit === null ? null : { entity: hit.entity, point: [...hit.point] });
  if (place === null) return null;
  const [px, py, pz] = place.point;
  return { asset, ...(name === "" ? {} : { name }), x: px, y: py, z: pz };
}

/**
 * A material asset that drops on the view goes on the part under the pointer: the mesh of a model (`mesh:<node>`) or
 * the shape of the entity. The drop runs the command `material.assign` (one step). `data-material-drop` on the canvas
 * gives `<entity>` or `<entity> <part>`.
 */
async function dropMaterial(parts: AssetDropParts, x: number, y: number, asset: string): Promise<void> {
  const { canvas } = parts;
  try {
    const hit = await parts.pick(x, y);
    if (hit === null) throw new Error("no entity under the pointer");
    const part = hit.target?.kind === "node" ? `${MESH_PART_PREFIX}${hit.target.id}` : "";
    await parts.commands.run("material.assign", {
      entity: hit.entity,
      material: asset,
      ...(part === "" ? {} : { part }),
    });
    canvas.dataset.materialDrop = part === "" ? hit.entity : `${hit.entity} ${part}`;
    delete canvas.dataset.entityError;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    canvas.dataset.entityError = reason;
    console.warn(`material.assign: ${reason}`);
  }
}

/** Listen to the drops of asset tiles on the canvas. The returned function stops the listeners. */
export function listenAssetDrop(parts: AssetDropParts): () => void {
  const { canvas } = parts;
  const over = (event: DragEvent): void => {
    if (!carriesAsset(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent): void => {
    if (!carriesAsset(event)) return;
    event.preventDefault();
    const asset = event.dataTransfer?.getData(ASSET_DRAG_TYPE) ?? "";
    const name = event.dataTransfer?.getData(ASSET_NAME_DRAG_TYPE) ?? "";
    const box = canvas.getBoundingClientRect();
    if (event.dataTransfer?.getData(ASSET_KIND_DRAG_TYPE) === "material") {
      void dropMaterial(parts, event.clientX - box.left, event.clientY - box.top, asset);
      return;
    }
    void (async () => {
      const args = await dropArgs(parts, event.clientX - box.left, event.clientY - box.top, asset, name);
      if (args === null) throw new Error("no place under the pointer");
      const run = await parts.commands.run("entity.add", args);
      const added = run.ops.find((op) => op.kind === "scene" && op.op.op === "add");
      canvas.dataset.drop = added?.kind === "scene" && added.op.op === "add" ? added.op.id : "";
      delete canvas.dataset.entityError;
    })().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      canvas.dataset.entityError = reason;
      console.warn(`entity.add: ${reason}`);
    });
  };
  canvas.addEventListener("dragover", over);
  canvas.addEventListener("drop", drop);
  return () => {
    canvas.removeEventListener("dragover", over);
    canvas.removeEventListener("drop", drop);
  };
}
