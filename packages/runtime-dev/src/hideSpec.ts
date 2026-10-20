// SPDX-License-Identifier: Apache-2.0
/**
 * The shapes of the solo and hide of the panes (hiding.ts does the hide in the core): plain data and plain functions,
 * so the lab page reads them without three.js.
 */
import type { SelectTarget } from "./pickMath";

/** The hide of one pane: the hidden items and, with `solo`, the only items that show. */
export interface PaneHide {
  readonly hidden: readonly SelectTarget[];
  /** The items that show alone; null: no solo. */
  readonly solo: readonly SelectTarget[] | null;
}

/** The hide of every pane, the main pane first; a pane without an entry (or null) hides nothing. */
export interface HideSpec {
  readonly panes: readonly (PaneHide | null)[];
}

/** No hide in any pane. */
export const NO_HIDE: HideSpec = { panes: [] };

/** The worker message type of the hide (a lab marker of tools/lab-markers.ts). */
export const PANE_HIDE_MESSAGE = "paneHide";

/** True when a pane hide hides something. */
export function hidesAny(pane: PaneHide | null | undefined): boolean {
  return pane != null && (pane.hidden.length > 0 || pane.solo !== null);
}

/** A plain copy of a hide spec for a worker message (no reactive values of a page). */
export function plainHide(spec: HideSpec): HideSpec {
  return {
    panes: spec.panes.map((pane) =>
      pane == null
        ? null
        : {
            hidden: pane.hidden.map((item) => ({ kind: item.kind, id: item.id })),
            solo: pane.solo === null ? null : pane.solo.map((item) => ({ kind: item.kind, id: item.id })),
          },
    ),
  };
}
