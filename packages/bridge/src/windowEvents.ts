// SPDX-License-Identifier: Apache-2.0
/**
 * The events of the detached windows on the bridge (frame to workbench page). Both stay in the workbench page.
 *
 * - `link`: a message of a link channel (the clock link) for the frames of the other windows; the page sends
 *   it to the host (`link.post`).
 * - `detach`: "Open in a window" of a part of the frame (the content browser, the graph, a pane); the
 *   page opens the window. For a pane, `query` has the number of the pane in the frame.
 */
import { isObject } from "./envelope";

/** The parts of a frame that open in their own window. */
export const DETACH_PANELS = ["dock", "graph", "pane"] as const;
export type DetachPanel = (typeof DETACH_PANELS)[number];

export type LinkEventBody = {
  readonly event: "link";
  readonly channel: string;
  readonly message: Readonly<Record<string, unknown>>;
};

export type DetachEventBody = {
  readonly event: "detach";
  readonly panel: DetachPanel;
  readonly query: Readonly<Record<string, string>>;
};

const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const QUERY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const QUERY_MAX_ENTRIES = 16;
const QUERY_MAX_VALUE = 2_000;

/** True for the name of a link channel. */
export function isLinkChannel(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_PATTERN.test(value);
}

/** The values of a window URL, or null for a value that is not such a map. */
export function panelQuery(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > QUERY_MAX_ENTRIES) return null;
  for (const [name, item] of entries) {
    if (!QUERY_NAME.test(name) || typeof item !== "string" || item.length > QUERY_MAX_VALUE) return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/** True for the fields of a `link` event. */
export function isLinkEvent(value: Readonly<Record<string, unknown>>): boolean {
  return isLinkChannel(value.channel) && isObject(value.message);
}

/** True for the fields of a `detach` event. */
export function isDetachEvent(value: Readonly<Record<string, unknown>>): boolean {
  return (DETACH_PANELS as readonly unknown[]).includes(value.panel) && panelQuery(value.query) !== null;
}
