// SPDX-License-Identifier: Apache-2.0
/**
 * The shared parts of the dock of the content browser: the icon of an item (from the plugin), the color of each
 * status, and the pictures of the items (stills/<name>.webp).
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import type { Component } from "vue";
import { editorPlugin } from "../plugin";
import { t } from "../../texts";
import type { BrowserItem } from "./tree";
import { sceneKey } from "./sceneKey";
import stills from "virtual:labs-stills";

/**
 * The pictures of the items: one static asset for each name (`bun run labs stills`). The plugin `labsStills`
 * (scripts/labsStills.ts) gives their URLs in one module, not one module for each picture.
 */
const STILL_URLS = new Map(Object.entries(stills));

/** The URL of the picture of an item, or null. */
export function stillUrl(item: BrowserItem): string | null {
  return item.still === null ? null : (STILL_URLS.get(item.still) ?? null);
}

/**
 * True when the picture of an item shows a scene that is different from the current scene of the item. `bun run labs
 * stills <key>` makes the picture again. The covers and a picture of the parent of an item (a folder) have no mark.
 */
export function stillStale(item: BrowserItem): boolean {
  if (item.still === null || item.scene === null) return false;
  // The plugin keeps the scene key of each picture (its stills/index.json).
  const kept = editorPlugin().browser.stills[item.still];
  return kept !== undefined && kept !== sceneKey(item.scene);
}

/** The number of pictures (the status line of the stills). */
export const STILL_COUNT = STILL_URLS.size;

/** The icon of an item (from the plugin). */
export function iconOf(item: BrowserItem): Component {
  return editorPlugin().browser.icon(item);
}

/** The color class of the status dot of a clip, and its words. */
export const STATUS_STYLE: Readonly<Record<string, { readonly dot: string; readonly words: string }>> = {
  capture: { dot: "bg-status-positive", words: t("browser-clip-capture") },
  proc: { dot: "bg-status-info", words: t("browser-clip-proc") },
  generic: { dot: "bg-status-neutral", words: t("browser-clip-generic") },
  none: { dot: "border border-text-secondary bg-transparent", words: t("browser-clip-none") },
};

/** The second line of a tile: the subtitle, with the family mark of a scene that shows only the family. */
export function tileNote(item: BrowserItem): string {
  if (item.scene === null && item.children.length === 0)
    return item.clip?.status === "none" ? t("browser-clip-none") : t("browser-not-in-lab");
  return item.subtitle;
}
