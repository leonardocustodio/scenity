// SPDX-License-Identifier: Apache-2.0
/**
 * The control of the transform gizmo: the targets, the frame and the shape of the
 * gizmo now, and the drags of its handles: a press on a handle, the moves of the pointer, the typed value and the end.
 * A drag is a live drag of the scene channel, so its end is one step of the history; Escape restores the start. A
 * drag with no pointer (the X, Y and Z keys) takes a typed value only. startGizmo.ts connects it to the page.
 *
 * The gizmo shows the posed scene (the scene at the time of the clock), so it stays on an animated entity. A
 * drag makes its ops on the posed scene, and `unposeOps` turns them into the same change of the base scene.
 */
import {
  activeSnaps,
  gizmoFrame,
  isLocked,
  transformTargets,
  typedKey,
  routeOverrides,
  unposeOps,
  type AxisIndex,
  type GizmoFrame,
  type ScreenPoint,
} from "@scenity/editor-core";
import { diffDocuments } from "@scenity/scene/ops";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { pageView, viewRay, type EditorPose } from "../dragMath";
import type { ScenePageEditor } from "../sceneEditor";
import { freeContext, type InspectPort } from "./freeDrag";
import { dragOps, ringTangent, type HandleDrag } from "./gizmoDrag";
import { gizmoShape, type GizmoShape, type Handle, type HandleId, type Projector } from "./gizmoHandles";
import type { GizmoMode, TransformSettings } from "./gizmoSettings";
import { mainViewBox } from "../viewport/mainView";

/** What the gizmo reads of the page. */
export interface GizmoParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly selection: {
    readonly ids: readonly string[];
    listen(listener: (ids: readonly string[]) => void): () => void;
  };
  readonly settings: TransformSettings;
  /** The camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera while it draws, else null. */
  editorView?(): EditorPose | null;
  readonly inspect?: InspectPort;
}

/** A drag that runs: the handle drag, its pointer (null for the keys), the typed text and the last pointer. */
interface ActiveDrag {
  readonly drag: HandleDrag;
  /** The base scene at the start of the drag (`drag.doc` is the posed scene then). */
  readonly base: SceneDocument;
  readonly pointer: number | null;
  typed: string;
  at: ScreenPoint;
  keys: { alt: boolean; shift: boolean };
}

const AXIS_NAMES = ["X", "Y", "Z"] as const;

/** The typed value of a drag that runs: the mode, the axis name (null: no axis) and the typed text. */
export interface TypedValue {
  readonly mode: GizmoMode;
  readonly axis: (typeof AXIS_NAMES)[number] | null;
  readonly text: string;
}

export class GizmoControl {
  readonly parts: GizmoParts;
  #active: ActiveDrag | null = null;
  /** The listeners of a change of the typed value or of the drag. */
  readonly #listeners = new Set<() => void>();

  constructor(parts: GizmoParts) {
    this.parts = parts;
  }

  /** The entities that the gizmo changes now: the selection with a transform and with no lock. */
  targets(): string[] {
    const { editor, selection } = this.parts;
    const doc = this.#inside() ? editor.expanded : editor.doc;
    return transformTargets(doc, selection.ids, (id) => isLocked(editor.doc, editor.view, id));
  }

  /** True when the selection holds an entity of a prefab instance (`<instance>/<entity>`). */
  #inside(): boolean {
    return this.parts.editor.expander !== null && this.parts.selection.ids.some((id) => id.includes("/"));
  }

  /** The posed scene, expanded when the selection holds an entity of a prefab instance. */
  #shown(): SceneDocument {
    const { editor } = this.parts;
    const posed = editor.posed();
    return this.#inside() ? (editor.expander?.expand(posed, editor.prefabs) ?? posed) : posed;
  }

  /** The frame of the gizmo now (a scale has the local axes), or null with no target. */
  frame(targets = this.targets()): GizmoFrame | null {
    const { mode, space, pivot } = this.parts.settings.value;
    return gizmoFrame(this.#shown(), targets, mode === "scale" ? "local" : space, pivot);
  }

  /**
   * The projection of the camera of the page on the canvas now (the editor camera while it draws), or null with no
   * camera.
   */
  projector(): Projector | null {
    const view = pageView(this.parts.editor.posed(), this.parts);
    // The gizmo works in the main view of a split view.
    const box = mainViewBox(this.parts.canvas);
    return view === null ? null : { view, width: box.width, height: box.height };
  }

  /** The gizmo on the screen now, or null (no target, no camera, or the origin behind the camera). */
  shape(): GizmoShape | null {
    const frame = this.frame();
    const projector = this.projector();
    if (frame === null || projector === null) return null;
    return gizmoShape(projector, frame, this.mode);
  }

  get mode(): TransformSettings["value"]["mode"] {
    return this.parts.settings.value.mode;
  }

  /** The handle of the drag that runs, or null. */
  get dragging(): HandleId | null {
    return this.#active?.drag.handle.id ?? null;
  }

  /** The typed value of the drag that runs, or null. */
  typed(): TypedValue | null {
    const active = this.#active;
    if (active === null || active.drag.handle.kind === "plane" || this.#freeMove(active.drag)) return null;
    const axis = active.drag.handle.axis;
    return { mode: active.drag.settings.mode, axis: axis === null ? null : AXIS_NAMES[axis], text: active.typed };
  }

  /** Call `listener` after each change of a drag; the result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #freeMove(drag: HandleDrag): boolean {
    return drag.settings.mode === "translate" && drag.handle.kind === "centre";
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }

  /**
   * Start a drag of a handle from a press at a canvas point (`pointer` null: a drag of the keys). False when the drag
   * cannot start. The free move reads the inspect report first, so its start waits for it.
   */
  async press(handle: Handle, at: ScreenPoint, pointer: number | null): Promise<boolean> {
    const { editor } = this.parts;
    const targets = this.targets();
    const frame = this.frame(targets);
    const projector = this.projector();
    const shape = this.shape();
    if (frame === null || projector === null || shape === null || editor.channel.live || this.#active !== null) {
      return false;
    }
    const base = editor.doc;
    const doc = this.#shown();
    const settings = this.parts.settings.value;
    const ray = viewRay(projector.view, at.x, at.y, projector.width, projector.height);
    const tangent = handle.kind === "ring" ? ringTangent({ handle, projector }, at) : null;
    const isFree = settings.mode === "translate" && handle.kind === "centre";
    const free = isFree ? await freeContext(doc, targets, frame.origin, this.parts.inspect) : null;
    // The free move waits for the inspect report: another edit or drag can start in the meantime.
    if (this.#busy(base)) return false;
    const drag = { handle, doc, targets, frame, settings, projector, size: shape.size, from: at, ray };
    editor.channel.begin();
    const keys = { alt: false, shift: false };
    this.#active = { drag: { ...drag, tangent, free }, base, pointer, typed: "", at, keys };
    this.parts.canvas.dataset.gizmoDrag = handle.id;
    this.#tell();
    return true;
  }

  /** True when the document is not `doc` any more, or a drag runs. */
  #busy(doc: unknown): boolean {
    return this.parts.editor.channel.live || this.#active !== null || this.parts.editor.doc !== doc;
  }

  /** Start a drag of the keys on an axis of the mode now (X, Y, Z); false when it cannot start. */
  async pressAxis(axis: AxisIndex): Promise<boolean> {
    const shape = this.shape();
    const id = AXIS_NAMES[axis].toLowerCase() as HandleId;
    const found = shape?.handles.find((handle) => handle.id === id);
    const kind = this.mode === "rotate" ? "ring" : "axis";
    const handle: Handle = found ?? { id, kind, axis, points: [], grabs: [] };
    return this.press(handle, shape?.centre ?? { x: 0, y: 0 }, null);
  }

  /** True when a drag of this pointer runs (null: a drag of the keys). */
  owns(pointer: number | null): boolean {
    return this.#active !== null && this.#active.pointer === pointer;
  }

  /** True while a drag runs. */
  get live(): boolean {
    return this.#active !== null;
  }

  /** A move of the pointer of the drag: apply the ops of the new point. */
  move(at: ScreenPoint, keys: { alt: boolean; shift: boolean }): void {
    const active = this.#active;
    if (active === null) return;
    active.at = at;
    active.keys = keys;
    this.#apply(active);
  }

  /** A key of a typed value: true when the key is part of a number (the drag shows the new value). */
  type(key: string): boolean {
    const active = this.#active;
    if (active === null || this.typed() === null) return false;
    const next = typedKey(active.typed, key);
    if (next === null) return false;
    active.typed = next;
    this.#apply(active);
    this.#tell();
    return true;
  }

  #apply(active: ActiveDrag): void {
    const { drag } = active;
    const { projector } = drag;
    const ray = viewRay(projector.view, active.at.x, active.at.y, projector.width, projector.height);
    const snaps = activeSnaps(drag.settings.snaps, active.keys);
    const ops = dragOps(drag, active.at, ray, snaps, active.typed);
    // A move of an entity of a prefab instance is an override of the instance.
    if (ops !== null && ops.length > 0)
      this.parts.editor.channel.move(routeOverrides(active.base, unposeOps(active.base, drag.doc, ops)));
  }

  /** End the drag: one step of the history, or no step when nothing changed; `cancel` restores the start. */
  end(cancel = false): void {
    const active = this.#active;
    if (active === null) return;
    this.#active = null;
    delete this.parts.canvas.dataset.gizmoDrag;
    const { editor } = this.parts;
    const same = diffDocuments(active.base, editor.doc).length === 0;
    editor.channel.end(cancel || same);
    editor.changed();
    this.#tell();
  }
}
