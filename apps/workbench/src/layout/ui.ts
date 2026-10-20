// SPDX-License-Identifier: Apache-2.0
/**
 * The shared classes and words of the workbench page, in the visual language of the lab panel
 * (apps/editor/src/core/labUi.ts). Developer page: its text is not in Fluent (tools/wording-allowlist.json).
 */
import type { ServerStatus } from "@scenity/workbench-host/protocol";
import type { HostState } from "../host/useHost";

/** Join the class names that are not false, null or undefined. The classes of one call must not conflict. */
export function cn(...classes: readonly (string | false | null | undefined)[]): string {
  return classes.filter((value) => typeof value === "string" && value !== "").join(" ");
}

/** A small button. */
export const button =
  "rounded-control border border-border-subtle bg-surface-sunken px-2 py-1 text-caption text-text-primary hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50";
/** A small square button with an icon. */
export const iconButton =
  "inline-flex size-8 items-center justify-center rounded-control border border-border-subtle bg-surface-sunken text-text-primary hover:border-border-strong";
/** A text field. */
export const field =
  "min-h-8 w-full rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption text-text-primary placeholder:text-text-secondary";
/** A tab of a bar: the shape, then the colors of a tab at rest or of the tab in use. */
const tabShape =
  "inline-flex h-7 items-center gap-1.5 rounded-control text-caption disabled:cursor-not-allowed disabled:opacity-40";
const tabIdle = "text-text-secondary hover:bg-surface-sunken hover:text-text-primary disabled:hover:bg-transparent";
const tabOn = "bg-surface-sunken text-text-primary shadow-raised";

/** The classes of a tab with text. */
export function tab(on = false): string {
  return cn(tabShape, "px-2", on ? tabOn : tabIdle);
}

/** The classes of a square tab with an icon. */
export function iconTab(on = false): string {
  return cn(tabShape, "size-7 justify-center", on ? tabOn : tabIdle);
}

/** A dot of a state: its color class and its words. */
export interface Dot {
  readonly color: string;
  readonly words: string;
}

export const HOST_DOTS: Readonly<Record<HostState, Dot>> = {
  looking: { color: "bg-status-neutral", words: "looking for the host" },
  none: { color: "bg-status-neutral", words: "no host" },
  connecting: { color: "bg-status-caution", words: "connecting" },
  connected: { color: "bg-status-positive", words: "connected" },
  lost: { color: "bg-status-negative", words: "connection lost" },
};

export const SERVER_DOTS: Readonly<Record<ServerStatus | "none", Dot>> = {
  none: { color: "bg-status-neutral", words: "no dev server" },
  stopped: { color: "bg-status-neutral", words: "stopped" },
  starting: { color: "bg-status-caution", words: "starting" },
  ready: { color: "bg-status-positive", words: "ready" },
  failed: { color: "bg-status-negative", words: "failed" },
};

/** The last part of a path: `/a/b/scenity` is `scenity`. */
export function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** A count with its noun: "1 file", "3 files". */
export function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
}

/** The time since an ISO time, in words: "14 s ago", "3 min ago". */
export function since(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${String(seconds)} s ago`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} min ago`;
  return `${String(Math.round(seconds / 3600))} h ago`;
}
