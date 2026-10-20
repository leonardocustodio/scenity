// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the content browser in the URL and in the browser storage. The URL has `dock`, `path`, `item`, `q`,
 * `filter` and `strip`. The storage keeps the recent items of this viewer. Each read and write can fail (a private
 * window), and the page works without the storage.
 */
import { parseFilters, type Filters } from "./search";

/**
 * The dock of the URL: `hidden` (`dock=0`, the tools), a start height (`bar`, `half`, `tall`), or `auto` (the layout of
 * the browser storage, dockLayout.ts).
 */
export type DockHeight = "bar" | "half" | "tall" | "hidden" | "auto";
export const DOCK_HEIGHTS: readonly DockHeight[] = ["bar", "half", "tall"];
export const STRIP_SLOTS = [8, 16, 32] as const;
export type StripSlots = (typeof STRIP_SLOTS)[number];

const STORE = { recent: "room3d-lab.recent" } as const;

export interface BrowserStart {
  readonly dock: DockHeight;
  readonly path: readonly string[];
  readonly item: string | null;
  readonly query: string;
  readonly filters: Filters;
  readonly slots: StripSlots;
}

function stored(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // No storage (a private window): the page keeps the value only in the URL.
  }
}

/** The dock height of the URL. `dock=0` (or the legacy `film=0`) hides the dock. A fixed frame has no dock. */
function dockOf(params: URLSearchParams, frozen: boolean): DockHeight {
  if (frozen) return "hidden";
  const value = params.get("dock");
  if (value === "0" || (value === null && params.get("film") === "0")) return "hidden";
  // `bar`, `half` and `tall` set the layout of the dock at the start (dockLayout.ts). Else, the storage sets it.
  return DOCK_HEIGHTS.find((height) => height === value) ?? "auto";
}

/** The start state of the browser from the URL and the storage. */
export function browserStart(params: URLSearchParams, frozen: boolean): BrowserStart {
  const slots = Number(params.get("strip"));
  return {
    dock: dockOf(params, frozen),
    path: (params.get("path") ?? "").split("/").filter((key) => key !== ""),
    item: params.get("item"),
    query: params.get("q") ?? "",
    filters: parseFilters(params.get("filter")),
    slots: STRIP_SLOTS.find((value) => value === slots) ?? 16,
  };
}

/** Write a parameter of the URL (an empty value removes it), without a new entry in the history. */
export function setParam(name: string, value: string | null): void {
  const url = new URL(globalThis.location.href);
  if (value === null || value === "") url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  if (url.href !== globalThis.location.href) globalThis.history.replaceState(globalThis.history.state, "", url);
}

export function storedRecent(): string[] {
  try {
    const value: unknown = JSON.parse(stored(STORE.recent) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function keepRecent(keys: readonly string[]): void {
  store(STORE.recent, JSON.stringify(keys));
}
