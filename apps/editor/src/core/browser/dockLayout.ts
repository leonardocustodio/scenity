// SPDX-License-Identifier: Apache-2.0
/**
 * The layout of the dock of the content browser. Each part opens and closes, and a resize handle changes each size.
 * The parts are the full dock, the timeline (the play bar, the frame strip and the clip lanes), the browser (the
 * folders and the grid) and the folders. The inspector is a tab of the side panel. The sizes are in rem, so the styles
 * name no raw pixels. The browser storage keeps the layout of this viewer. A read or a write can fail (a private
 * window), and then the page uses the defaults.
 */
import { reactive, watch } from "vue";
import type { DockHeight } from "./browserUrl";

export interface DockLayout {
  /** The full dock. A closed dock shows only its header. */
  open: boolean;
  /** The height of the dock under its header when the browser shows (rem). */
  height: number;
  /** The play bar, the frame strip and the clip lanes. */
  timeline: boolean;
  /** The height of a frame of the strip (rem). The width has an aspect of 4:3. */
  stripHeight: number;
  /** The folders and the grid. */
  browser: boolean;
  /** The tree of folders at the left, and its width (rem). */
  tree: boolean;
  treeWidth: number;
}

/** The limits of each size (rem). */
export const LIMITS = {
  height: { min: 8, max: 60 },
  stripHeight: { min: 2, max: 14 },
  treeWidth: { min: 9, max: 32 },
} as const;

export type LayoutSize = keyof typeof LIMITS;

const STORE = "room3d-lab.dock-layout";

/** The layout of a new viewer: all parts open. On a narrow screen (less than 768 px), the folders are closed. */
export function defaultLayout(width = globalThis.innerWidth): DockLayout {
  return {
    open: true,
    height: 24,
    timeline: true,
    stripHeight: 3.75,
    browser: true,
    tree: width >= 768,
    treeWidth: 14,
  };
}

/** A size in its limits. The height also stays less than the window height minus 10 rem for the scene. */
export function clampSize(size: LayoutSize, value: number, rem = 16, windowHeight = globalThis.innerHeight): number {
  const { min } = LIMITS[size];
  const max =
    size === "height" ? Math.max(min, Math.min(LIMITS.height.max, windowHeight / rem - 10)) : LIMITS[size].max;
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

function stored(): Partial<DockLayout> {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage.getItem(STORE) ?? "{}");
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

/** The layout fields of a stored value that have the type of the default. */
function merged(base: DockLayout, kept: Partial<DockLayout>): DockLayout {
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof DockLayout)[]) {
    const value = kept[key];
    if (typeof value === typeof base[key]) Object.assign(out, { [key]: value });
  }
  return out;
}

/**
 * The layout of the page: the storage, then the `dock` URL parameter of the tools and the tests. `bar` shows only the
 * timeline, `half` gives the default height, and `tall` gives 45 % of the window.
 */
export function useDockLayout(start: DockHeight): DockLayout {
  const layout = reactive(merged(defaultLayout(), stored()));
  applyHeight(layout, start);
  watch(
    layout,
    (value) => {
      try {
        globalThis.localStorage.setItem(STORE, JSON.stringify(value));
      } catch {
        // No storage: the layout lasts for this page only.
      }
    },
    { deep: true },
  );
  return layout;
}

/** A dock height of the URL or of the script API on the layout. */
export function applyHeight(layout: DockLayout, height: DockHeight, rem = 16): void {
  if (height === "hidden" || height === "auto") return;
  layout.open = true;
  layout.browser = height !== "bar";
  if (height === "tall") layout.height = clampSize("height", (globalThis.innerHeight * 0.45) / rem);
  if (height === "half") layout.height = defaultLayout().height;
}

/** The current dock height of the layout, for the script API and the tests. */
export function heightOf(layout: DockLayout): "closed" | "bar" | "open" {
  if (!layout.open) return "closed";
  return layout.browser ? "open" : "bar";
}
