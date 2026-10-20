// SPDX-License-Identifier: Apache-2.0
/**
 * The editor camera of the viewport: the orbit camera of `@scenity/editor-core` and its link to the runtime. The
 * editor camera is not in the document. The page sends its view with the "camera" message of the protocol.
 *
 * - The first move of the editor camera starts from the view of the document camera that draws, with the target in
 *   front of it at the depth of the centre of the scene (5 m when the scene has no box).
 * - A move sends the view at the next animation frame with `userCamera: true`. Thus the levels of detail use their
 *   hysteresis while the camera moves. `settle` sends the view again without the flag when the move stops.
 * - `frame` puts the target at the centre of the boxes of the selection (from the inspect report). With no selection,
 *   it uses the box of the scene. The distance shows the boxes on the canvas (`frameBox`).
 * - A document camera of the menu or of a number key draws through `__scenity.camera`. The editor camera keeps its
 *   view for the next time.
 */
import { frameBox, orbitFromView, unionBox, viewOf, type OrbitCamera, type WorldBox } from "@scenity/editor-core";
import { vadd, vdot, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { cameraEntity, pageView } from "../dragMath";
import { telephoto, turnedTo, type EditorViewName, type Projection } from "./editorViews";
import type { ViewportParts } from "./viewportTypes";

/** The depth of the target in front of a document camera when the scene has no box (metres). */
const DEFAULT_DEPTH = 5;
/** The half size of the box that frames an entity with no geometry (metres). */
const POINT_HALF = 0.5;

/** The world box of a report box. */
function worldBox(box: { readonly min: readonly number[]; readonly max: readonly number[] }): {
  min: Vec3;
  max: Vec3;
} {
  const vec = (values: readonly number[]): Vec3 => [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
  return { min: vec(box.min), max: vec(box.max) };
}

/** The boxes of the selected entities of a report, else the box of the scene. */
export function frameTarget(report: SceneInspectReport, ids: readonly string[]): WorldBox | null {
  const chosen = new Set(ids);
  const boxes = report.entities
    .filter((entity) => chosen.has(entity.id) && entity.bounds !== null)
    .map((entity) => worldBox(entity.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] }));
  if (boxes.length > 0) return unionBox(boxes);
  // An entity with no geometry (a light, a camera) frames a box of 1 m round its place.
  const around = (at: readonly number[], side: number): number[] => at.map((value) => value + side * POINT_HALF);
  const points = report.entities
    .filter((entity) => chosen.has(entity.id))
    .map((entity) =>
      worldBox({ min: around(entity.transform.position, -1), max: around(entity.transform.position, 1) }),
    );
  if (points.length > 0) return unionBox(points);
  return report.bounds === null ? null : worldBox(report.bounds);
}

export class ViewportCamera {
  readonly #parts: ViewportParts;
  /** The last view of the editor camera, or null before its first move. */
  #orbit: OrbitCamera | null = null;
  /** The centre of the scene from the last inspect report, or null. */
  #centre: Vec3 | null = null;
  #moving = false;
  #sendFrame: number | null = null;
  /** The projection of the editor camera. */
  #projection: Projection = "perspective";

  constructor(parts: ViewportParts) {
    this.#parts = parts;
  }

  /** True while the editor camera draws. */
  get active(): boolean {
    return this.#parts.editorView() !== null;
  }

  /** True while the user moves the editor camera. */
  get moving(): boolean {
    return this.#moving;
  }

  /** Keep the centre of the scene of a report: a first move starts with its depth. */
  learn(report: SceneInspectReport | null): void {
    const box = report?.bounds;
    if (box !== null && box !== undefined) this.#centre = vscale(vadd(worldBox(box).min, worldBox(box).max), 0.5);
  }

  /** The current editor camera: its view while it draws, else the view of the document camera. Null with no view. */
  current(): OrbitCamera | null {
    if (this.active && this.#orbit !== null) return this.#orbit;
    const view = pageView(this.#parts.editor.posed(), { camera: () => this.#parts.camera() });
    if (view === null) return this.#orbit;
    const ahead = this.#centre === null ? DEFAULT_DEPTH : vdot(vsub(this.#centre, view.position), view.forward);
    const depth = ahead > 0.5 ? ahead : DEFAULT_DEPTH;
    return orbitFromView({
      position: view.position,
      target: vadd(view.position, vscale(view.forward, depth)),
      fov: view.fov,
    });
  }

  /** Move the editor camera to a view. `moving` is true for a move of the user that continues. */
  move(next: OrbitCamera, moving: boolean): void {
    this.#orbit = next;
    this.#moving = moving;
    this.#parts.canvas.dataset.camera = "editor";
    if (!moving) {
      this.#send();
      return;
    }
    this.#sendFrame ??= requestAnimationFrame(() => {
      this.#sendFrame = null;
      this.#send();
    });
  }

  /** Change the editor camera immediately with a function of it, as a move of the user. */
  change(edit: (camera: OrbitCamera) => OrbitCamera, moving = true): void {
    const camera = this.current();
    if (camera !== null) this.move(edit(camera), moving);
  }

  /** The move of the user stops: send the view again without the user flag. */
  settle(): void {
    if (!this.#moving) return;
    this.#moving = false;
    if (this.#sendFrame !== null) cancelAnimationFrame(this.#sendFrame);
    this.#sendFrame = null;
    if (this.active || this.#orbit !== null) this.#send();
  }

  /** The projection of the editor camera. */
  get projection(): Projection {
    return this.#projection;
  }

  /** Change the projection. The editor camera draws at its view with the new projection. */
  setProjection(next: Projection): void {
    this.#projection = next;
    this.useEditor();
  }

  /** Turn the editor camera to a view along a world axis. The target and the distance do not change. */
  view(name: EditorViewName): void {
    const camera = this.#orbit ?? this.current();
    if (camera !== null) this.move(turnedTo(camera, name), false);
  }

  /** Draw with the editor camera at its last view (the menu, the 0 key). */
  useEditor(): void {
    const camera = this.#orbit ?? this.current();
    if (camera !== null) this.move(camera, false);
  }

  /** Draw with a document camera by ID or name. The result is false when there is no such camera. */
  async useDocument(name: string): Promise<boolean> {
    this.settle();
    const found = cameraEntity(this.#parts.editor.doc, name);
    if (found === null || !(await this.#parts.port.openCamera(found))) return false;
    this.#parts.canvas.dataset.camera = found;
    return true;
  }

  /** Frame the boxes of the selection (else of the scene) with the editor camera. False with no box. */
  async frame(aspect: number): Promise<boolean> {
    const report = (await this.#parts.inspect?.()) ?? null;
    this.learn(report);
    const box = report === null ? null : frameTarget(report, this.#parts.selection.ids);
    const camera = this.current();
    if (box === null || camera === null) return false;
    this.move(frameBox(camera, box, aspect), false);
    return true;
  }

  /** Send the view of the editor camera to the runtime. */
  #send(): void {
    if (this.#orbit === null) return;
    const view = viewOf(this.#orbit);
    // The orthographic projection is a long lens with the same view at the target.
    const sent = this.#projection === "orthographic" ? telephoto(view) : view;
    this.#parts.port.useEditor({ ...sent, userCamera: this.#moving });
  }
}
