// SPDX-License-Identifier: Apache-2.0
/**
 * The drop of a clip of the clip browser on the Scene view: the clip plays on the character under the pointer. The
 * page picks the entity under the pointer. A key of the clip goes on the animation track of that entity at the time of
 * the clock (one step of the history). A clip of another model plays retargeted. The
 * drop needs an open sequence. `data-clip-drop` on the canvas gives the entity; a refusal goes to `data-entity-error`.
 */
import type { PickHit } from "@scenity/runtime/protocol";
import type { ScenePageEditor } from "../sceneEditor";
import { CLIP_DRAG_TYPE, clipCommand, readClipDrag, type ClipDrag } from "./clipBrowser";

/** What the drop reads of the page. */
export interface ClipDropParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  pick(x: number, y: number): Promise<PickHit | null>;
}

/** Put a key of the clip on the entity with a model under a canvas point (CSS pixels); the result is the entity. */
async function playOn(parts: ClipDropParts, x: number, y: number, drag: ClipDrag): Promise<string> {
  const api = globalThis.__scenity;
  const sequence = api?.sequence?.() ?? null;
  if (sequence === null) throw new Error("no open sequence");
  const hit = await parts.pick(x, y);
  if (hit === null || parts.editor.doc.entities[hit.entity]?.components.model === undefined) {
    throw new Error("no model under the pointer");
  }
  const { command, args } = clipCommand(sequence, { ...drag, entity: hit.entity }, api?.time?.() ?? 0);
  await api?.sequenceCommand?.(command, args);
  return hit.entity;
}

/** Listen to the drops of clips on the canvas; the result stops the listeners. */
export function listenClipDrop(parts: ClipDropParts): () => void {
  const { canvas } = parts;
  const over = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes(CLIP_DRAG_TYPE) !== true) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent): void => {
    const drag = readClipDrag(event.dataTransfer?.getData(CLIP_DRAG_TYPE) ?? "");
    if (drag === null) return;
    event.preventDefault();
    const box = canvas.getBoundingClientRect();
    playOn(parts, event.clientX - box.left, event.clientY - box.top, drag).then(
      (entity) => {
        canvas.dataset.clipDrop = entity;
        delete canvas.dataset.entityError;
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        canvas.dataset.entityError = reason;
        console.warn(`clip drop: ${reason}`);
      },
    );
  };
  canvas.addEventListener("dragover", over);
  canvas.addEventListener("drop", drop);
  return () => {
    canvas.removeEventListener("dragover", over);
    canvas.removeEventListener("drop", drop);
  };
}
