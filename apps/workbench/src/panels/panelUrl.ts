// SPDX-License-Identifier: Apache-2.0
/**
 * The URLs of the detached windows: the workbench page with one panel (`?panel=<kind>&key=<key>&p.<name>=<value>`), and
 * the lab frame of a lab panel (the content browser alone, the metrics graph, a pane of the split screen) that follows
 * the clock of the main lab.
 */
import type { DetachedPanel, HostEndpoint, PanelKind } from "@scenity/workbench-host/protocol";
import { isPanelKey, isPanelKind } from "@scenity/workbench-host/protocol";

/** The words of the memory cost of a detached pane (the same words as apps/editor `follow/detach.ts`). */
export const PANE_COST_TEXT =
  "A detached pane is a second window with its own 3D context and its own copy of the room assets: about 1 GB more memory (measured in the labs app).";

/** The URL parameter of the panel kind. */
export const PANEL_PARAM = "panel";
/** The prefix of the panel values in the page URL. */
const VALUE_PREFIX = "p.";

/** The dock tab of each dock panel kind (the tab names of BottomBar.vue). */
export const DOCK_TABS: Readonly<Partial<Record<PanelKind, string>>> = {
  runs: "Runs",
  changes: "Changes",
  review: "Review",
  sessions: "Sessions",
  picker: "Picker",
};

/** The dock panel kind of a dock tab, or null. */
export function kindOfTab(tab: string): PanelKind | null {
  const found = Object.entries(DOCK_TABS).find(([, name]) => name === tab);
  return found === undefined ? null : (found[0] as PanelKind);
}

/** The title of a detached window. */
export function panelTitle(panel: Pick<DetachedPanel, "kind" | "query">): string {
  if (panel.kind === "claude") return "Claude";
  if (panel.kind === "dock") return "Content browser";
  if (panel.kind === "graph") return "Metrics graph";
  if (panel.kind === "pane") return `Pane: ${panel.query.cam ?? "camera"}`;
  return DOCK_TABS[panel.kind] ?? panel.kind;
}

/** The panel of a page URL, or null for the workbench page with all its parts. */
export function panelOf(search: string): Omit<DetachedPanel, "rect"> | null {
  const params = new URLSearchParams(search);
  const kind = params.get(PANEL_PARAM);
  const key = params.get("key") ?? kind;
  if (!isPanelKind(kind) || !isPanelKey(key)) return null;
  const query: Record<string, string> = {};
  for (const [name, value] of params) if (name.startsWith(VALUE_PREFIX)) query[name.slice(VALUE_PREFIX.length)] = value;
  return { key, kind, query };
}

/** The query text of the page of a panel (without `?`). */
export function panelSearch(panel: Omit<DetachedPanel, "rect">): string {
  const params = new URLSearchParams({ [PANEL_PARAM]: panel.kind, key: panel.key });
  for (const [name, value] of Object.entries(panel.query)) params.set(`${VALUE_PREFIX}${name}`, value);
  return params.toString();
}

/**
 * The URL of the page of a panel in a browser: this page with the panel query, and the host and its token as the
 * first tab has them (`?host=<origin>#token=<token>`, start/newWindow.ts).
 */
export function panelPageUrl(href: string, panel: Omit<DetachedPanel, "rect">, endpoint: HostEndpoint): string {
  const url = new URL(href);
  url.search = `?${panelSearch(panel)}`;
  url.searchParams.set("host", endpoint.origin);
  url.hash = `token=${endpoint.token}`;
  return url.toString();
}

/** A key for a new panel: the kind, and for a pane the first free `pane-<n>`. */
export function newPanelKey(kind: PanelKind, used: readonly string[]): string {
  if (kind !== "pane") return kind;
  for (let index = 1; ; index += 1) if (!used.includes(`pane-${String(index)}`)) return `pane-${String(index)}`;
}

/** The parameters that a follower lab frame does not keep from the lab URL of the main window. */
const MAIN_ONLY = ["panes", "cams", "sel", "graph", "item", "path", "q", "filter", "view", "camera", "only", "dock"];

/**
 * The URL of the lab frame of a lab panel, from the lab URL of the main window (its take, its events, its time and
 * the secret of its server): `follow=1` and `panel=0`, and
 * - `dock`: the content browser alone (`only=dock`, `dock=tall`), no 3D scene;
 * - `graph`: the metrics graph alone (`view=graph`);
 * - `pane`: one camera (`cam`: a name, or `view:x,y,z,tx,ty,tz,fov`) without the dock.
 */
export function panelFrameUrl(panel: Pick<DetachedPanel, "kind" | "query">, labUrl: string): string {
  const url = new URL(labUrl);
  const item = url.searchParams.get("item");
  for (const name of MAIN_ONLY) url.searchParams.delete(name);
  url.searchParams.set("follow", "1");
  url.searchParams.set("panel", "0");
  if (panel.kind === "dock") {
    url.searchParams.set("only", "dock");
    url.searchParams.set("dock", "tall");
    if (item !== null) url.searchParams.set("item", item);
  } else if (panel.kind === "graph") {
    url.searchParams.set("view", "graph");
  } else {
    const cam = panel.query.cam ?? "overview";
    if (cam.startsWith("view:")) url.searchParams.set("view", cam.slice("view:".length));
    else url.searchParams.set("camera", cam);
    url.searchParams.set("dock", "0");
  }
  url.hash = "";
  return url.toString();
}
