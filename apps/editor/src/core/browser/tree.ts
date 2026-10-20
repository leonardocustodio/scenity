// SPDX-License-Identifier: Apache-2.0
/**
 * The tree of the content browser. The plugin makes the tree (`EditorPlugin.browser`). This module has the reads of
 * the tree that the dock uses: the children of a path, the breadcrumb, the leaves, the recent keys and the counts of
 * the status line.
 *
 * This module has no Vue import, because the tools and the tests read it. A function reads the plugin when it runs,
 * never when the module loads.
 */
import type { Component } from "vue";
import type { BrowserItem, BrowserTree, ItemScene } from "../../plugins";
import { editorPlugin } from "../plugin";

export type { BrowserItem, BrowserTree, ItemScene };

/** The content browser of a plugin. */
export interface EditorBrowser {
  /** The tree of the items (the plugin reads its asset manifest). */
  tree(): BrowserTree;
  /** The icon of an item. */
  icon(item: BrowserItem): Component;
  /** The scene key of each picture by its name (stills/index.json). A picture of a different scene is stale. */
  readonly stills: Readonly<Record<string, string>>;
  /** The family of the clip of an item, or null (no clip, or a clip without a family). */
  familyOf(item: BrowserItem): string | null;
  /** The scene of the review of a clip family. */
  reviewScene(family: string): ItemScene;
}

/** The tree of the plugin. */
export function browserTree(): BrowserTree {
  return editorPlugin().browser.tree();
}

/** The clip family of an item (the plugin), or null. */
export function familyOf(item: BrowserItem): string | null {
  return editorPlugin().browser.familyOf(item);
}

/** The children of a path (the root: the categories), or the categories for an unknown path. */
export function childrenOf(tree: BrowserTree, path: readonly string[]): readonly BrowserItem[] {
  const last = path.at(-1);
  if (last === undefined) return tree.roots;
  return tree.byKey.get(last)?.children ?? tree.roots;
}

/** The nodes of a path as the breadcrumb shows them (without the unknown keys). */
export function crumbs(tree: BrowserTree, path: readonly string[]): readonly BrowserItem[] {
  return path.flatMap((key) => {
    const item = tree.byKey.get(key);
    return item === undefined ? [] : [item];
  });
}

/** The first folder with the clips of a family (the review of a clip family), or undefined. */
export function familyFolder(tree: BrowserTree, family: string): BrowserItem | undefined {
  return [...tree.byKey.values()].find(
    (node) => node.kind === "group" && node.children.some((child) => child.clip?.family === family),
  );
}

/** The leaves under a node (all of them for the root). */
export function leavesOf(items: readonly BrowserItem[]): BrowserItem[] {
  return items.flatMap((item) => (item.children.length === 0 ? [item] : leavesOf(item.children)));
}

/** The recent keys with a key at the start (no duplicate), at most `max`. */
export function pushRecent(recent: readonly string[], key: string, max = 8): string[] {
  return [key, ...recent.filter((item) => item !== key)].slice(0, max);
}

/** The counts of a node for the status line: the leaves, the leaves with a scene, the drawn and the captured clips. */
export function counts(items: readonly BrowserItem[]): {
  readonly items: number;
  readonly playable: number;
  readonly drawn: number;
  readonly captured: number;
  readonly none: number;
} {
  const leaves = leavesOf(items);
  const status = (value: string) => leaves.filter((item) => item.clip?.status === value).length;
  return {
    items: leaves.length,
    playable: leaves.filter((item) => item.scene !== null).length,
    drawn: status("proc") + status("generic"),
    captured: status("capture"),
    none: status("none"),
  };
}
