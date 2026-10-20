// SPDX-License-Identifier: Apache-2.0
/**
 * The layout of the edit mode as the settings tab and the script API see it. It has the open state of the Hierarchy
 * (the left panel) and of the Inspector (the right panel), the open panels, and the reset. The dock of the studio
 * shell keeps the layout and its sizes (studio/shell/dock.ts). This module reads the layout and changes it.
 */
import type { DockState } from "../../studio/shell/dock";
import { currentShell } from "../../studio/shell/shell";

/** The layout of the editor window. */
export interface PageLayout extends DockState {
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
}

/** The parts of the dock that the layout uses. */
export interface LayoutDock {
  isOpen(id: string): boolean;
  open(id: string): void;
  close(id: string): void;
  reset(): void;
  state(): DockState;
  onChange(listener: () => void): () => void;
}

const EMPTY: DockState = {
  workspace: "",
  panels: [],
  active: null,
  maximized: false,
  floating: [],
  folded: false,
  shown: null,
};

/** The panels of the sides. */
const SIDES = { leftOpen: "hierarchy", rightOpen: "inspector" } as const;

/** The layout over a dock. With no dock (no edit mode), the layout is empty. */
export class PageLayoutView {
  readonly #dock: () => LayoutDock | null;

  constructor(dock: () => LayoutDock | null) {
    this.#dock = dock;
  }

  get value(): PageLayout {
    const dock = this.#dock();
    return {
      leftOpen: dock?.isOpen(SIDES.leftOpen) ?? false,
      rightOpen: dock?.isOpen(SIDES.rightOpen) ?? false,
      ...(dock?.state() ?? EMPTY),
    };
  }

  /** Open or close the side panels. */
  update(change: Partial<Pick<PageLayout, "leftOpen" | "rightOpen">>): void {
    const dock = this.#dock();
    if (dock === null) return;
    for (const side of ["leftOpen", "rightOpen"] as const) {
      const open = change[side];
      if (open === true) dock.open(SIDES[side]);
      else if (open === false) dock.close(SIDES[side]);
    }
  }

  /** The default layout. */
  reset(): void {
    this.#dock()?.reset();
  }

  listen(listener: () => void): () => void {
    return this.#dock()?.onChange(listener) ?? (() => undefined);
  }
}

const view = new PageLayoutView(() => currentShell()?.dock ?? null);

/** The layout of the page. */
export function pageLayout(): PageLayoutView {
  return view;
}
