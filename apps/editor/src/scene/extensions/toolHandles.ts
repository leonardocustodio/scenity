// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of a scene tool of a plugin (the `sceneTools` point). While the tool is active, each handle is a dot over
 * the Scene view at its world point, as the pins of the changes (viewport/changePins.ts): HTML over the canvas, never a
 * part of a frame of the core. The layer reads the handles and the view at each frame. A drag moves a handle on the
 * level plane of its point: the tool gets the new point at each move and at the release.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { StudioHandle } from "../../studio/extensions/api";
import { levelHit, pageView, projectPoint, viewRay, type CameraView } from "../dragMath";

/** The size of a handle (CSS pixels). */
const HANDLE_PX = 14;

/** The view of the Scene view now (the editor camera or the document camera that draws), or null. */
export function viewportView(doc: SceneDocument): CameraView | null {
  let info;
  try {
    info = globalThis.__scenity?.viewport?.() ?? null;
  } catch {
    return null;
  }
  if (info === null) return null;
  const editor = info.camera === "editor" && info.position !== null && info.target !== null && info.fov !== null;
  return pageView(doc, {
    camera: () => (info.camera === "editor" ? null : info.camera),
    editorView: () =>
      editor ? { position: info.position ?? [0, 0, 0], target: info.target ?? [0, 0, 0], fov: info.fov ?? 50 } : null,
  });
}

/** The parts of a handle layer. */
export interface ToolHandleParts {
  handles(): readonly StudioHandle[];
  move(id: string, point: readonly [number, number, number], done: boolean): void;
  view(): CameraView | null;
}

/** The drag of a layer: the handle in a drag and its point now, or null. */
interface DragState {
  now: { id: string; point: [number, number, number] } | null;
}

/** The point of a pointer event on the canvas (CSS pixels) and the size of the canvas. */
function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width, height: box.height };
}

/** The button of a handle: a press starts a drag on the level plane of its point. */
function handleButton(
  handle: StudioHandle,
  canvas: HTMLCanvasElement,
  parts: ToolHandleParts,
  drag: DragState,
): HTMLButtonElement {
  const made = document.createElement("button");
  made.type = "button";
  made.dataset.testid = "tool-handle";
  made.dataset.handle = handle.id;
  made.className = "rounded-full border-2 border-text-inverse bg-accent-brand shadow";
  made.style.cssText = `position:absolute;left:0;top:0;width:${String(HANDLE_PX)}px;height:${String(HANDLE_PX)}px;pointer-events:auto;cursor:grab;touch-action:none`;
  made.addEventListener("pointerdown", (event) => {
    const now = parts.handles().find((item) => item.id === handle.id);
    if (now === undefined) return;
    made.setPointerCapture(event.pointerId);
    drag.now = { id: handle.id, point: [...now.point] };
    event.preventDefault();
    event.stopPropagation();
  });
  made.addEventListener("pointermove", (event) => {
    const view = parts.view();
    if (drag.now?.id !== handle.id || view === null) return;
    const at = canvasPoint(canvas, event);
    const hit = levelHit(viewRay(view, at.x, at.y, at.width, at.height), drag.now.point[1]);
    if (hit === null) return;
    drag.now = { id: handle.id, point: [hit[0], drag.now.point[1], hit[2]] };
    parts.move(handle.id, drag.now.point, false);
  });
  const release = (): void => {
    if (drag.now?.id !== handle.id) return;
    const done = drag.now;
    drag.now = null;
    parts.move(done.id, done.point, true);
  };
  made.addEventListener("pointerup", release);
  made.addEventListener("pointercancel", release);
  return made;
}

/** Show the handles of a tool over the canvas; the result removes them. */
export function startToolHandles(canvas: HTMLCanvasElement, parts: ToolHandleParts): () => void {
  const layer = document.createElement("div");
  layer.dataset.testid = "tool-handles";
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  canvas.parentElement?.append(layer);
  const buttons = new Map<string, HTMLButtonElement>();
  const drag: DragState = { now: null };
  let frame = 0;
  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    const view = parts.view();
    const box = canvas.getBoundingClientRect();
    const seen = new Set<string>();
    for (const handle of parts.handles()) {
      seen.add(handle.id);
      let element = buttons.get(handle.id);
      if (element === undefined) {
        element = handleButton(handle, canvas, parts, drag);
        layer.append(element);
        buttons.set(handle.id, element);
      }
      element.title = handle.label ?? handle.id;
      element.setAttribute("aria-label", handle.label ?? handle.id);
      const point = drag.now?.id === handle.id ? drag.now.point : handle.point;
      const at = view === null ? null : projectPoint(view, [...point], box.width, box.height);
      element.hidden = at === null;
      if (at !== null) {
        const half = HANDLE_PX / 2;
        element.style.transform = `translate(${String(at.x - half)}px, ${String(at.y - half)}px)`;
      }
    }
    for (const [id, element] of buttons) {
      if (seen.has(id)) continue;
      element.remove();
      buttons.delete(id);
    }
  };
  draw();
  return () => {
    cancelAnimationFrame(frame);
    layer.remove();
  };
}
