// SPDX-License-Identifier: Apache-2.0
/**
 * Solo and hide in the panes of the labs core. Each pane can hide some items (props, members, scratch props, the items
 * of the plugin kinds) or show only some items (solo). It is a view of the lab, not an input of a frame: the scene
 * input, the tune values and `frameKey` do not hold it.
 *
 * - **The frame of the page**: before the render of a pane, the core hides the objects of the items that the pane does
 *   not show (`visible = false`), and after the render it shows them again. The update of the scene does not see it.
 * - **Solo**: the items of the solo list and the items that hold them show; every other item of the pane hides. The
 *   room shell, the parts without an owner, the lights and the lab layers (the outline, the overlay, the ghosts) stay.
 * - **The pictures**: a capture shows every item unless it asks for the hide of its pane (`CaptureTarget.hidden`); the
 *   pictures of the frame index never hide (the core draws them without this hook).
 * - **The pick** of a pane skips the items that the pane hides.
 *
 * The plain shapes are in hideSpec.ts (the lab page reads them without three.js).
 */
import type { Object3D } from "three";
import { hidesAny, NO_HIDE, plainHide, type HideSpec, type PaneHide } from "./hideSpec";
import type { SelectTarget } from "./pickMath";
import { isLabLayer, itemOfName } from "./pick";

function inList(item: { readonly kind: string; readonly id: string }, list: readonly SelectTarget[]): boolean {
  return list.some((entry) => entry.kind === item.kind && entry.id === item.id);
}

/** The item of a node, by its name (pick.ts itemOfName), or null. */
function itemOf(node: Object3D): { kind: string; id: string } | null {
  return node.name === "" ? null : itemOfName(node.name);
}

/** The nodes that hold an item of the solo list (the parents of each solo node): they stay visible. */
function soloHolders(scene: Object3D, solo: readonly SelectTarget[]): Set<Object3D> {
  const holders = new Set<Object3D>();
  scene.traverse((node) => {
    const item = itemOf(node);
    if (item === null || !inList(item, solo)) return;
    for (let up = node.parent; up !== null; up = up.parent) holders.add(up);
  });
  return holders;
}

/**
 * Hide the items of a pane hide in the scene: each object of a hidden item (and with solo, of each item that is not in
 * the solo list and holds none) gets `visible = false`. Returns the function that shows them again, or null when
 * nothing changed. The lab layers stay as they are.
 */
export function applyHide(scene: Object3D, pane: PaneHide | null | undefined): (() => void) | null {
  if (pane == null || !hidesAny(pane)) return null;
  const { hidden, solo } = pane;
  const holders = solo === null ? new Set<Object3D>() : soloHolders(scene, solo);
  const changed: Object3D[] = [];
  const visit = (node: Object3D): void => {
    if (isLabLayer(node.name)) return;
    const item = itemOf(node);
    if (item !== null) {
      const soloed = solo !== null && inList(item, solo);
      const hide = inList(item, hidden) || (solo !== null && !soloed && !holders.has(node));
      if (hide) {
        if (node.visible) {
          node.visible = false;
          changed.push(node);
        }
        return;
      }
      // Everything inside an item of the solo list shows with it.
      if (soloed) return;
    }
    for (const child of node.children) visit(child);
  };
  visit(scene);
  if (changed.length === 0) return null;
  return () => {
    for (const node of changed) node.visible = true;
  };
}

/** The hide of the panes in the labs core: the spec, and the switch of a picture that shows every item. */
export class PaneHiding {
  private spec: HideSpec = NO_HIDE;
  /** True while the core draws a picture that does not follow the hide (a capture that does not ask for it). */
  private suppressed = false;

  set(spec: HideSpec): void {
    this.spec = spec;
  }

  /** The current spec (the script API `hidden()`). */
  get(): HideSpec {
    return plainHide(this.spec);
  }

  /** True when a pane hides something. */
  get active(): boolean {
    return this.spec.panes.some(hidesAny);
  }

  suppress(on: boolean): void {
    this.suppressed = on;
  }

  /** Hide the items of a pane in the scene for one render (or a pick); the function shows them again. */
  apply(scene: Object3D, pane: number): (() => void) | null {
    if (this.suppressed) return null;
    return applyHide(scene, this.spec.panes[pane]);
  }
}
