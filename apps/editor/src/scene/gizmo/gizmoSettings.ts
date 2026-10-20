// SPDX-License-Identifier: Apache-2.0
/**
 * The settings of the transform gizmos of the scene page: the mode (move, turn,
 * scale), the axes (world or local), the pivot (each origin or the centre of the selection) and the snaps. They are
 * view values of the page: no op, no history step, no part of the file. The entity drag (sceneDrag.ts) and the gizmos
 * (startGizmo.ts, a lazy chunk) read the same settings.
 */
import { DEFAULT_SNAPS, type SnapSettings, type TransformPivot, type TransformSpace } from "@scenity/editor-core";

/** The mode of the gizmo: the W, E and R keys; "view" (the Q key) shows no gizmo and moves nothing. */
export type GizmoMode = "view" | "translate" | "rotate" | "scale";

/** The settings of the gizmos. */
export interface GizmoSettings {
  readonly mode: GizmoMode;
  readonly space: TransformSpace;
  readonly pivot: TransformPivot;
  readonly snaps: SnapSettings;
}

/** A change of the settings: each part is optional, and the snaps change part by part. */
export interface GizmoChange {
  readonly mode?: GizmoMode;
  readonly space?: TransformSpace;
  readonly pivot?: TransformPivot;
  readonly snaps?: Partial<SnapSettings>;
}

export const DEFAULT_GIZMO: GizmoSettings = { mode: "translate", space: "world", pivot: "pivot", snaps: DEFAULT_SNAPS };

/** The settings of one page with listeners. */
export class TransformSettings {
  #value: GizmoSettings = DEFAULT_GIZMO;
  readonly #listeners = new Set<(value: GizmoSettings) => void>();

  get value(): GizmoSettings {
    return this.#value;
  }

  /** Apply a change and tell each listener. */
  set(change: GizmoChange): GizmoSettings {
    const { snaps, ...rest } = change;
    this.#value = { ...this.#value, ...rest, snaps: { ...this.#value.snaps, ...snaps } };
    for (const listener of this.#listeners) listener(this.#value);
    return this.#value;
  }

  /** Call `listener` after each change; the result stops it. */
  listen(listener: (value: GizmoSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
