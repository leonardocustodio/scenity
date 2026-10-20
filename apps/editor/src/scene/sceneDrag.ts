// SPDX-License-Identifier: Apache-2.0
/**
 * The entity drag of the scene page in the edit mode. A press on an entity with a `model` and a `transform` component
 * picks it. A move of the pointer moves it, and the selection with it when the entity is selected. The move snaps as
 * the lab snap does (gizmo/freeDrag.ts): onto the surface under the pointer (the top of the box of an entity), then to
 * a socket within 8 cm, else over the level plane of the press point. x and z go on the grid of the snap settings
 * (Shift: ten times the grid; Alt: no snap). The release ends the drag as one step of the history, and Escape cancels
 * it. Each move is `set` ops of `transform/position` through the scene channel. Thus the runtime gets a "patch" and the
 * document stays the one source of the frame. A locked entity does not move. The gizmos of the selection are in
 * gizmo/startGizmo.ts.
 */
import { activeSnaps, transformTargets } from "@scenity/editor-core";
import type { PickHit } from "@scenity/runtime/protocol";
import { pageView, viewRay, type CameraView, type EditorPose } from "./dragMath";
import { freeContext, freeOps, type FreeContext, type InspectPort } from "./gizmo/freeDrag";
import type { TransformSettings } from "./gizmo/gizmoSettings";
import { playing } from "./play/playState";
import type { ScenePageEditor } from "./sceneEditor";
import { mainViewBox } from "./viewport/mainView";

/** The snaps of a drag with no settings: a 1 cm grid, no surface snap. */
const GRID_ONLY = {
  grid: 0.01,
  gridOn: true,
  angle: 15,
  angleOn: true,
  scale: 0.1,
  scaleOn: true,
  surface: false,
} as const;

/** What the drag reads of the page. */
export interface DragParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The name of the camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera while it draws, else null. */
  editorView?(): EditorPose | null;
  /** The snap settings (default: the grid only), the inspect report for the surfaces, the selection. */
  readonly settings?: TransformSettings;
  readonly inspect?: InspectPort;
  readonly selection?: { readonly ids: readonly string[] };
  /** True for a locked entity. */
  locked?(id: string): boolean;
}

/** A drag that runs. */
interface Drag {
  readonly id: string;
  readonly view: CameraView;
  readonly context: FreeContext;
  readonly pointer: number;
}

/** True when the entity can take a body drag: a model and a transform, and no lock. */
function movable(parts: DragParts, id: string): boolean {
  const components = parts.editor.doc.entities[id]?.components;
  return components?.model !== undefined && components.transform !== undefined && parts.locked?.(id) !== true;
}

/** The entities of a drag of `id`: the selection with `id` first when it is selected, else `id` alone. */
function dragTargets(parts: DragParts, id: string): string[] {
  const selected = parts.selection?.ids ?? [];
  const ids = selected.includes(id) ? [id, ...selected.filter((other) => other !== id)] : [id];
  return transformTargets(parts.editor.doc, ids, (other) => parts.locked?.(other) === true);
}

/** The ray of the pointer through the camera of a drag. */
function pointerRay(parts: DragParts, view: CameraView, event: PointerEvent) {
  const box = mainViewBox(parts.canvas);
  return viewRay(view, event.clientX - box.left, event.clientY - box.top, box.width, box.height);
}

/** Start the drag of the entity under a press, or give null. */
async function begin(parts: DragParts, event: PointerEvent): Promise<Drag | null> {
  const box = parts.canvas.getBoundingClientRect();
  const hit = await parts.pick(event.clientX - box.left, event.clientY - box.top);
  const doc = parts.editor.doc;
  const view = pageView(doc, parts);
  if (hit === null || view === null || !movable(parts, hit.entity)) return null;
  const targets = dragTargets(parts, hit.entity);
  const context = await freeContext(doc, targets, [...hit.point], parts.inspect);
  if (context === null || targets[0] !== hit.entity) return null;
  parts.editor.channel.begin();
  return { id: hit.entity, view, context, pointer: event.pointerId };
}

/** Listen to the pointer of the canvas; the result stops the listeners. */
export function listenDrag(parts: DragParts): () => void {
  const { canvas, editor } = parts;
  let drag: Drag | null = null;
  let pressed = false;
  const down = (event: PointerEvent): void => {
    // In the play mode, a press goes to the input maps of the plugins only (no entity drag).
    if (event.button !== 0 || pressed || editor.channel.live || playing()) return;
    pressed = true;
    // The viewport does not turn the camera while the pick of the press runs.
    canvas.dataset.press = "1";
    void begin(parts, event).then((started) => {
      delete canvas.dataset.press;
      // A press that turns the camera does not drag.
      // The View tool selects and moves nothing.
      const view = parts.settings?.value.mode === "view";
      drag = pressed && canvas.dataset.orbit === undefined && !view ? started : null;
      if (started !== null && drag === null) editor.channel.end(true);
      if (drag === null) return;
      canvas.setPointerCapture(drag.pointer);
      // A test waits for this mark before it moves the pointer.
      canvas.dataset.drag = drag.id;
    });
  };
  const move = (event: PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    const snaps = activeSnaps(parts.settings?.value.snaps ?? GRID_ONLY, { alt: event.altKey, shift: event.shiftKey });
    const moved = freeOps(drag.context, pointerRay(parts, drag.view, event), snaps);
    if (moved === null) return;
    editor.channel.move(moved.ops);
    // The snap target of the last move (a test and the overlay read it).
    canvas.dataset.snap = moved.move.socket?.ref ?? moved.move.surface?.id ?? "";
  };
  const end = (cancel: boolean): void => {
    pressed = false;
    if (drag === null) return;
    drag = null;
    delete canvas.dataset.drag;
    editor.channel.end(cancel);
    editor.changed();
  };
  const up = (): void => end(false);
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") end(true);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key);
  };
}
