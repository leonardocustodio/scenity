// SPDX-License-Identifier: Apache-2.0
/**
 * The fold of the side areas on a small screen. Below 1280×720, the groups of the left and the right areas hide. Then
 * a rail of tabs on each edge of the window shows their panels. A press on a tab shows its side (one side at a time).
 * A panel of a side that becomes active also shows its side. A panel of the centre or the bottom that becomes active
 * folds the side again. The stored layouts never keep the fold.
 */
import { markRaw, shallowReactive } from "vue";
import type { DockviewGroupPanel } from "dockview-vue";
import type { Dock } from "./dock";

/** The window sizes that fold the sides. */
export const FOLD_QUERY = "(max-width: 1279.98px), (max-height: 719.98px)";

export type FoldSide = "left" | "right";
export const FOLD_SIDES: readonly FoldSide[] = ["left", "right"];

export interface FoldState {
  /** True when the window is small: the sides fold. */
  folded: boolean;
  /** The side that shows while the window is small, or null. */
  shown: FoldSide | null;
  /** The open panels of each side, in the order of their groups. */
  left: readonly string[];
  right: readonly string[];
  /** The active panel of the dock. */
  active: string | null;
}

interface GridNode {
  readonly type?: string;
  readonly data?: unknown;
  readonly visible?: boolean;
}

/** A node of a stored grid with each hidden node shown again (its size is the size before the fold). */
function shownNode(node: GridNode): GridNode {
  const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "visible")) as GridNode;
  return rest.type === "branch" && Array.isArray(rest.data)
    ? { ...rest, data: (rest.data as GridNode[]).map(shownNode) }
    : rest;
}

/** A stored layout of the dock with no folded group. */
export function unfolded<T>(layout: T): T {
  const grid = (layout as { grid?: { root?: GridNode } }).grid;
  if (grid?.root === undefined) return layout;
  return { ...layout, grid: { ...grid, root: shownNode(grid.root) } };
}

/** The fold of the sides of one dock. */
export class DockFold {
  readonly state = shallowReactive<FoldState>({ folded: false, shown: null, left: [], right: [], active: null });
  readonly #dock: Dock;
  /** The groups that the fold hides (a maximized group also hides the others, and the fold does not change them). */
  readonly #hidden = new Set<DockviewGroupPanel>();
  /** The size of the dock with no rails (the shell gives it). */
  #measure: () => { width: number; height: number } | null = () => null;

  constructor(dock: Dock) {
    this.#dock = dock;
    markRaw(this);
  }

  /**
   * Follow the size of the window and the changes of the dock. The result stops it. `measure` gives the size of the
   * dock with no rails. The dock takes that size before the sides show again, so the Scene view gets the new space.
   */
  start(
    measure: () => { width: number; height: number } | null = () => null,
    query: MediaQueryList | null = typeof matchMedia === "function" ? matchMedia(FOLD_QUERY) : null,
  ): () => void {
    this.#measure = measure;
    const stopLayout = this.#dock.onChange(() => this.#refresh());
    const active = this.#dock.api.onDidActivePanelChange((event) => this.#activate(event.panel?.id ?? null));
    const change = (event: { matches: boolean }): void => this.setFolded(event.matches);
    query?.addEventListener("change", change);
    this.setFolded(query?.matches ?? false);
    return () => {
      stopLayout();
      active.dispose();
      query?.removeEventListener("change", change);
    };
  }

  setFolded(folded: boolean): void {
    const size = folded ? null : this.#measure();
    if (size !== null && size.width > 0) this.#dock.api.layout(size.width, size.height);
    this.state.folded = folded;
    this.state.shown = null;
    this.#refresh();
  }

  /** Show a side while the window is small (null folds both). */
  show(side: FoldSide | null): void {
    this.state.shown = side;
    this.#apply();
  }

  /** A press on the tab of a panel in a rail: show its side with the panel, or fold the side when it shows. */
  press(id: string): void {
    const side = this.sideOf(id);
    if (side === null) return;
    if (this.state.shown === side && this.state.active === id) {
      this.show(null);
      return;
    }
    this.#dock.open(id);
  }

  /**
   * While the window is small, show the side of a panel that becomes active. A panel of no side folds the sides. The
   * dock calls this function before it opens a panel.
   */
  reveal(id: string): void {
    if (!this.state.folded) return;
    const side = this.sideOf(id);
    if (side !== this.state.shown) this.show(side);
  }

  /** The side of an open panel in the grid, or null (the centre, the bottom, a floating panel). */
  sideOf(id: string): FoldSide | null {
    const panel = this.#dock.api.getPanel(id);
    if (panel?.api.location.type !== "grid") return null;
    return FOLD_SIDES.find((side) => this.#groups(side).includes(panel.group)) ?? null;
  }

  #activate(id: string | null): void {
    this.state.active = id;
    if (id !== null) this.reveal(id);
  }

  #refresh(): void {
    this.state.left = this.#groups("left").flatMap((group) => group.panels.map((panel) => panel.id));
    this.state.right = this.#groups("right").flatMap((group) => group.panels.map((panel) => panel.id));
    this.state.active = this.#dock.api.activePanel?.id ?? null;
    this.#apply();
  }

  /** Hide the groups of each side that does not show. Show the groups that the fold hid before. */
  #apply(): void {
    if (this.#dock.api.hasMaximizedGroup()) return;
    for (const side of FOLD_SIDES) {
      const visible = !this.state.folded || this.state.shown === side;
      for (const group of this.#groups(side)) {
        if (visible && this.#hidden.delete(group)) group.api.setVisible(true);
        else if (!visible && group.api.isVisible) {
          this.#hidden.add(group);
          group.api.setVisible(false);
        }
      }
    }
  }

  /** The docked groups of a side: the groups with a panel of the area of the side. */
  #groups(side: FoldSide): DockviewGroupPanel[] {
    return this.#dock.api.groups.filter(
      (group) =>
        group.api.location.type === "grid" && group.panels.some((panel) => this.#dock.areaOf(panel.id) === side),
    );
  }
}
