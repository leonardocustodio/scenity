// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the detached windows and of the window layout. `protocol.ts` exports them. This module is pure (no
 * `node:` or `bun:` import), so the page gets them through `@scenity/workbench-host/protocol`.
 *
 * - The link (`link.post`, the event `link.message`): a page sends a message on a named channel, and the host sends it
 *   to every other page of the host. The lab frames use the channel `scenity-clock` (the clock link of apps/editor
 *   `core/graph/clockLink.ts`), so a lab in a second window follows the clock of the lab in the main window. The host
 *   keeps the last message that a page marks with `keep` (the clock state). A new window reads it with `link.kept`.
 * - The layout (`layout.*`, the event `layout.state`): the host keeps the window layout of each checkout in its state
 *   folder (`layout.json`): the Claude column, the open dock tab, the place of the main window and the detached
 *   windows with their places. A restart of the host or of the app restores it. A detached window tells the host its
 *   key (`layout.join`); when it closes while a main page stays connected, the host removes it from the layout.
 *
 * The link channel names and the window URL values of the bridge events are in @scenity/bridge.
 */
import { panelQuery } from "@scenity/bridge";

/** The kinds of a detached window: a part of the workbench page, or a lab frame alone. */
export const PANEL_KINDS = [
  "claude",
  "runs",
  "changes",
  "review",
  "sessions",
  "picker",
  "dock",
  "graph",
  "pane",
] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** The kinds that show a lab frame: the content browser, the metrics graph and a pane of the split screen. */
export const LAB_PANEL_KINDS: readonly PanelKind[] = ["dock", "graph", "pane"];

/** The place of a window on the screen (CSS pixels: `screenX`, `screenY`, `innerWidth`, `innerHeight`). */
export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A detached window: its key, its kind, the values of its URL and its place. */
export interface DetachedPanel {
  /** Unique in the layout: `[a-z0-9-]`, at most 40 characters (for example `runs` or `pane-1`). */
  readonly key: string;
  readonly kind: PanelKind;
  /** The values of the window URL (for a pane: `cam`). */
  readonly query: Readonly<Record<string, string>>;
  readonly rect: WindowRect | null;
}

/** The window layout of a checkout. */
export interface WindowLayout {
  /** True or false when the owner showed or hid the Claude column; null before a choice. */
  readonly claude: boolean | null;
  /** The open dock tab of the main window, or null. */
  readonly dockTab: string | null;
  /** The place of the main window, or null. */
  readonly main: WindowRect | null;
  readonly detached: readonly DetachedPanel[];
  /** True after the owner saw the memory cost of a detached pane once. */
  readonly paneCost: boolean;
}

/** The layout of a checkout without a saved layout. */
export const EMPTY_LAYOUT: WindowLayout = { claude: null, dockTab: null, main: null, detached: [], paneCost: false };

/** The layout and the keys of the detached windows that are connected now. */
export interface LayoutView {
  readonly layout: WindowLayout;
  readonly open: readonly string[];
  /** The panel that `layout.dock` took back (the event only): the main page puts it back in its place. */
  readonly docked?: DetachedPanel;
}

/** The longest JSON text of a link message (characters): 8 M, under the 16 MB frame limit of the socket. */
export const LINK_MAX_CHARS = 8 * 1024 * 1024;
/** The most detached windows of a layout. */
export const MAX_DETACHED = 12;

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DOCK_TAB_PATTERN = /^[A-Za-z]{1,20}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for the key of a detached window. */
export function isPanelKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function isPanelKind(value: unknown): value is PanelKind {
  return typeof value === "string" && (PANEL_KINDS as readonly string[]).includes(value);
}

/** The place of a window, or null for a value that is not a place (each value finite, the sizes 1 to 20000). */
export function windowRect(value: unknown): WindowRect | null {
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  const numbers = [x, y, width, height];
  if (!numbers.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const [left, top, wide, high] = numbers.map((item) => Math.round(item as number)) as [number, number, number, number];
  if (wide < 1 || high < 1 || wide > 20_000 || high > 20_000 || Math.abs(left) > 50_000 || Math.abs(top) > 50_000) {
    return null;
  }
  return { x: left, y: top, width: wide, height: high };
}

/** A detached window, or null for a value that is not one. */
export function detachedPanel(value: unknown): DetachedPanel | null {
  if (!isObject(value) || !isPanelKey(value.key) || !isPanelKind(value.kind)) return null;
  const query = panelQuery(value.query);
  if (query === null) return null;
  return { key: value.key, kind: value.kind, query, rect: windowRect(value.rect) };
}

/** A layout from saved JSON: each bad part takes the value of EMPTY_LAYOUT; a bad window drops out. */
export function readLayout(value: unknown): WindowLayout {
  if (!isObject(value)) return EMPTY_LAYOUT;
  const detached: DetachedPanel[] = [];
  for (const item of Array.isArray(value.detached) ? value.detached : []) {
    const panel = detachedPanel(item);
    if (panel !== null && !detached.some((other) => other.key === panel.key)) detached.push(panel);
  }
  return {
    claude: typeof value.claude === "boolean" ? value.claude : null,
    dockTab: typeof value.dockTab === "string" && DOCK_TAB_PATTERN.test(value.dockTab) ? value.dockTab : null,
    main: windowRect(value.main),
    detached: detached.slice(0, MAX_DETACHED),
    paneCost: value.paneCost === true,
  };
}

/** The changes of `layout.set`. */
export interface LayoutPatch {
  readonly claude?: boolean;
  readonly dockTab?: string | null;
  readonly paneCost?: boolean;
}

/** A layout with the valid parts of a patch; a bad part throws an error with its name. */
export function patchLayout(layout: WindowLayout, patch: object): WindowLayout {
  const values = patch as Record<string, unknown>;
  let next = layout;
  if (values.claude !== undefined) {
    if (typeof values.claude !== "boolean") throw new Error('The parameter "claude" must be true or false.');
    next = { ...next, claude: values.claude };
  }
  if (values.dockTab !== undefined) {
    const tab = values.dockTab;
    if (tab !== null && (typeof tab !== "string" || !DOCK_TAB_PATTERN.test(tab))) {
      throw new Error('The parameter "dockTab" must be the name of a dock tab or null.');
    }
    next = { ...next, dockTab: tab };
  }
  if (values.paneCost !== undefined) {
    if (typeof values.paneCost !== "boolean") throw new Error('The parameter "paneCost" must be true or false.');
    next = { ...next, paneCost: values.paneCost };
  }
  return next;
}

/** The requests of the link and of the layout (page to host). `RequestMap` of protocol.ts extends this map. */
export interface WindowRequests {
  /** Send a message to the other pages on a channel. `keep` keeps it for `link.kept`. */
  "link.post": { params: { channel: string; message: unknown; keep?: boolean }; result: null };
  /** The last kept message of a channel, or null. */
  "link.kept": { params: { channel: string }; result: { message: unknown } | null };
  /** The layout of the open checkout. `main: true` marks the page as a main window. */
  "layout.get": { params: { main?: boolean }; result: LayoutView };
  /** Change the Claude column, the dock tab or the pane cost choice. */
  "layout.set": { params: LayoutPatch; result: LayoutView };
  /** Add a detached window (a second call with the same key replaces it). */
  "layout.detach": { params: { panel: DetachedPanel }; result: LayoutView };
  /** Take a detached window back into the main window ("Dock back"). */
  "layout.dock": { params: { key: string }; result: LayoutView };
  /** A detached window tells its key after its connection. */
  "layout.join": { params: { key: string }; result: LayoutView };
  /** The current place of a window (`main` for the main window). */
  "layout.rect": { params: { key: string; rect: WindowRect }; result: null };
}

export const WINDOW_REQUEST_NAMES: Readonly<Record<keyof WindowRequests, true>> = {
  "link.post": true,
  "link.kept": true,
  "layout.get": true,
  "layout.set": true,
  "layout.detach": true,
  "layout.dock": true,
  "layout.join": true,
  "layout.rect": true,
};

/** The events of the link and of the layout (host to page). `EventMap` of protocol.ts extends this map. */
export interface WindowEvents {
  /** A message of another page. `from` is the number of the page on the host. */
  "link.message": { channel: string; from: number; message: unknown };
  /** The layout after a change, or a detached window that connected or closed. */
  "layout.state": LayoutView;
}

export const WINDOW_EVENT_NAMES: Readonly<Record<keyof WindowEvents, true>> = {
  "link.message": true,
  "layout.state": true,
};
