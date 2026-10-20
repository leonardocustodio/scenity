// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the content browser: the tree, the node of the grid, the search, the filters, the open item, the
 * window of the play bar, the dock height and the recent items. The URL and the browser storage keep them
 * (browserUrl.ts). `open` plays the scene of an item. The take and its events go into the live take, and the camera
 * goes to the camera of the scene. The loop goes around the window, and the clock plays. The browser never changes the
 * lab state directly. It pushes events and moves the clock, as the panel does.
 *
 * The module shows no text. The dock components have the Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { LabCamera } from "../useLabCamera";
import type { LabClock } from "../useLabClock";
import type { LabTake } from "../useLabTake";
import { editorPlugin } from "../plugin";
import { takeNamed } from "../sequence";
import { browserStart, keepRecent, setParam, storedRecent, type DockHeight, type StripSlots } from "./browserUrl";
import {
  browserTree,
  childrenOf,
  crumbs,
  familyFolder,
  familyOf,
  pushRecent,
  type BrowserItem,
  type BrowserTree,
  type ItemScene,
} from "./tree";
import { useDockLayout, type DockLayout } from "./dockLayout";
import { filterText, search, type Filters } from "./search";
import type { FrameStrip } from "./useFrameStrip";

/** The parts of the lab that the open action drives. */
export interface BrowserDeps {
  readonly take: LabTake;
  readonly clock: LabClock;
  readonly camera: LabCamera;
  /** The member of the team tab. */
  readonly selectedId: Ref<string>;
  /** The glTF characters and props (false: the graybox). */
  readonly useAssets: Ref<boolean>;
  /** A fixed frame of the visual tests: no dock. */
  readonly frozen: boolean;
}

export interface OpenOptions {
  /** False: stop at the start of the window. The default plays the window in a loop. */
  readonly play?: boolean;
}

export interface LabBrowser {
  readonly tree: BrowserTree;
  /** The keys of the node that the grid shows (empty: the categories). */
  readonly path: Ref<string[]>;
  readonly query: Ref<string>;
  readonly filters: Ref<Filters>;
  /** The open item, or null. */
  readonly item: ShallowRef<BrowserItem | null>;
  /** The window of the play bar (the time of the open item), or null for the whole take. */
  readonly window: Ref<{ readonly from: number; readonly to: number } | null>;
  readonly dock: Ref<DockHeight>;
  readonly slots: Ref<StripSlots>;
  readonly recent: Ref<string[]>;
  /** The tiles of the grid: the search results, else the children of the path. */
  readonly items: ComputedRef<readonly BrowserItem[]>;
  readonly crumbs: ComputedRef<readonly BrowserItem[]>;
  browse(path: readonly string[]): void;
  /** Move to the parent level of the path (or clear the search). */
  up(): void;
  /** Open an item by its key. Returns false when the key is unknown or the item has no scene. */
  open(key: string, options?: OpenOptions): boolean;
  /** Show the full take in the play bar (the loop stays). */
  wholeTake(): void;
  /** The number of frames of the strip. */
  setSlots(count: StripSlots): void;
  /** The family of a review without an open clip (`review=<family>`), or null. */
  readonly reviewFamily: Ref<string | null>;
  /** True while the Review section of the inspector is open. */
  readonly reviewOpen: Ref<boolean>;
  /**
   * The review of a clip family (`review=<family>`). The first clip of the family with a scene opens with the Review
   * section of the inspector. A family without such a clip plays its review scene.
   */
  openReview(family: string): void;
  /** The open parts and the sizes of the dock. The browser storage keeps them. */
  readonly layout: DockLayout;
  /** The number of the items that opened with a scene (the dock fills the strip of each new item). */
  readonly opened: Ref<number>;
  /** The frame strip of the dock while the dock shows it, else null. The script API reads it. */
  readonly strip: ShallowRef<FrameStrip | null>;
  attachStrip(strip: FrameStrip | null): void;
  /** Play a scene that is not an item (the review of a clip family), with its window in the play bar. */
  play(scene: ItemScene, options?: OpenOptions): void;
  /** Show in the grid the first folder with the clips of a family. Returns false when no folder has them. */
  reveal(family: string): boolean;
}

/** The browser state in the URL (and the dock height in the storage). */
function keepInUrl(state: {
  readonly path: Ref<string[]>;
  readonly query: Ref<string>;
  readonly filters: Ref<Filters>;
  readonly dock: Ref<DockHeight>;
  readonly slots: Ref<StripSlots>;
}): void {
  watch(state.path, (value) => {
    setParam("path", value.join("/"));
  });
  watch(state.query, (value) => {
    setParam("q", value.trim());
  });
  watch(
    state.filters,
    (value) => {
      setParam("filter", filterText(value));
    },
    { deep: true },
  );
  // The storage keeps the layout of the dock (dockLayout.ts). The URL keeps only the dock of the tools (`dock=0`).
  watch(state.dock, (value) => {
    setParam("dock", value === "hidden" ? "0" : null);
  });
  watch(state.slots, (value) => {
    setParam("strip", value === 16 ? null : String(value));
  });
}

/** The scene into the lab: the take, its events, the camera, the member, the loop and the clock. */
export function playScene(deps: BrowserDeps, scene: ItemScene, options: OpenOptions): void {
  const { take, clock, camera } = deps;
  take.loadTake(scene.take);
  take.setEvents(scene.events.slice(takeNamed(scene.take)?.events.length ?? 0));
  if (typeof scene.camera === "string") camera.setCamera(scene.camera);
  else camera.setView(scene.camera);
  if (scene.cast !== null) deps.selectedId.value = scene.cast;
  if (deps.useAssets.value !== scene.assets) deps.useAssets.value = scene.assets;
  clock.loopFrom.value = scene.window.from;
  clock.loopTo.value = scene.window.to;
  clock.seek(scene.window.from);
  if (options.play === false) clock.pause();
  else clock.play();
  take.refresh();
}

/** The review of a family: its first clip with a scene, else its review scene. */
function openReview(
  state: { readonly reviewFamily: Ref<string | null>; readonly reviewOpen: Ref<boolean>; readonly path: Ref<string[]> },
  tree: BrowserTree,
  family: string,
  open: (key: string) => boolean,
  play: (scene: ItemScene) => void,
): void {
  const clips = [...tree.byKey.values()].filter(
    (node) => node.clip !== undefined && !node.key.includes("~") && familyOf(node) === family && node.scene !== null,
  );
  const best = clips.find((node) => node.scene?.exact === true) ?? clips[0];
  state.reviewOpen.value = true;
  if (best !== undefined) {
    state.path.value = best.path.slice(0, -1);
    open(best.key);
    return;
  }
  const folder = familyFolder(tree, family);
  if (folder !== undefined) state.path.value = [...folder.path];
  state.reviewFamily.value = family;
  play(editorPlugin().browser.reviewScene(family));
}

/** The refs of the browser from the URL and the storage. */
function startState(frozen: boolean, tree: BrowserTree) {
  const start = browserStart(new URLSearchParams(globalThis.location.search), frozen);
  // A reload with `item`: the take, the events and the time of the URL give the frame. The item and its window return.
  const restored = start.item === null ? null : (tree.byKey.get(start.item) ?? null);
  return {
    path: ref<string[]>([...start.path]),
    query: ref(start.query),
    filters: ref<Filters>(start.filters),
    item: shallowRef<BrowserItem | null>(restored),
    window: ref<{ from: number; to: number } | null>(restored?.scene?.window ?? null),
    dock: ref<DockHeight>(start.dock),
    slots: ref<StripSlots>(start.slots),
    recent: ref<string[]>(storedRecent()),
    strip: shallowRef<FrameStrip | null>(null),
    /** The family of a review without an open clip (`review=<family>`), and the open Review section. */
    reviewFamily: ref<string | null>(null),
    reviewOpen: ref(false),
    /** The open parts and the sizes of the dock. */
    layout: useDockLayout(start.dock),
    /** The number of the items that opened with a scene. The dock fills the strip of each item. */
    opened: ref(0),
  };
}

export function useBrowser(deps: BrowserDeps): LabBrowser {
  const tree = browserTree();
  const state = startState(deps.frozen, tree);
  const { path, query, filters, item, window, dock, slots, recent, strip, opened } = state;

  const searching = computed(() => query.value.trim() !== "" || filterText(filters.value) !== "");
  const items = computed(() =>
    searching.value
      ? // The search examines each category, not only the folder of the path.
        search(tree, query.value, filters.value)
      : childrenOf(tree, path.value),
  );

  keepInUrl({ path, query, filters, dock, slots });

  function open(key: string, options: OpenOptions = {}): boolean {
    const found = tree.byKey.get(key);
    if (found === undefined) return false;
    if (found.children.length > 0) {
      path.value = [...found.path];
      return true;
    }
    item.value = found;
    state.reviewFamily.value = null;
    setParam("item", key);
    recent.value = pushRecent(recent.value, key);
    keepRecent(recent.value);
    window.value = found.scene?.window ?? null;
    if (found.scene !== null) {
      playScene(deps, found.scene, options);
      opened.value += 1;
    }
    return found.scene !== null;
  }

  return {
    ...state,
    tree,
    items,
    crumbs: computed(() => crumbs(tree, path.value)),
    browse(next) {
      path.value = next.filter((key) => tree.byKey.has(key));
    },
    up() {
      if (searching.value) {
        query.value = "";
        filters.value = {};
      } else {
        path.value = path.value.slice(0, -1);
      }
    },
    open,
    wholeTake() {
      window.value = null;
    },
    setSlots(value) {
      slots.value = value;
    },
    attachStrip(next) {
      strip.value = next;
    },
    play(scene, options = {}) {
      window.value = scene.window;
      playScene(deps, scene, options);
    },
    openReview(family) {
      openReview(state, tree, family, open, (scene) => {
        window.value = scene.window;
        playScene(deps, scene, {});
      });
    },
    reveal(family) {
      const folder = familyFolder(tree, family);
      if (folder !== undefined) path.value = [...folder.path];
      return folder !== undefined;
    },
  };
}
