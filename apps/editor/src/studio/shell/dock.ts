// SPDX-License-Identifier: Apache-2.0
/**
 * The dock of the editor window. It has the layout of the active workspace and the switch to a different workspace.
 * It also has the actions on the panels that the commands and the Window menu run (open, close, float, move to an
 * area, maximize, the next panel). Each action works by keyboard through its command. The layout of each workspace
 * goes to the workspace state after each change, and the dock reads it again at the next start. If the dock cannot
 * read a stored layout, it uses the default layout of the workspace.
 */
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-vue";
import { markRaw } from "vue";
import { DockFold, unfolded, type FoldSide } from "./fold";
import { COPY_MARK, type PanelArea, type PanelRegistry } from "./panels";
import type { Workspaces } from "./workspaceState";
import type { DockArea, WorkspaceSpec } from "./workspaces";

/** The name of the one panel component and of the one tab component of the dock (StudioShell.vue). */
export const PANEL_COMPONENT = "studioPanel";
export const TAB_COMPONENT = "studioTab";
/** The panel that is in each layout: the Scene view holds the canvas. */
export const CENTRE_PANEL = "scene.view";
/**
 * The panels whose content stays in the page when a different tab of their group shows. They are the canvas of the
 * Scene view (its core continues to draw) and the frame of the Game view (its player continues to play).
 */
const KEEP_MOUNTED = new Set([CENTRE_PANEL, "game.view"]);

/** The sizes of the default layout. */
const LEFT_PX = 260;
const RIGHT_PX = 320;
const BOTTOM_SHARE = 0.3;
/** The bottom area keeps room for the asset tiles under the header of the Project panel when the window has it. */
const BOTTOM_MIN_PX = 240;

/** The height of the bottom area of a default layout: a share of the dock, and 240 px or more up to 45 %. */
export function bottomHeight(dockHeight: number, share = BOTTOM_SHARE): number {
  return Math.round(Math.max(dockHeight * share, Math.min(BOTTOM_MIN_PX, dockHeight * 0.45)));
}

/** The smallest size of a docked group by the area of its panels. The Scene view gets a change of the window first. */
const LIMITS: Readonly<Record<PanelArea, { minimumWidth?: number; minimumHeight?: number }>> = {
  left: { minimumWidth: 180 },
  right: { minimumWidth: 240 },
  bottom: { minimumHeight: 140 },
  centre: { minimumWidth: 320, minimumHeight: 200 },
  floating: {},
};

/** The place of a new group of an area, from the Scene view. */
const PLACES: Readonly<Record<Exclude<DockArea, "centre">, "left" | "right" | "bottom">> = {
  left: "left",
  right: "right",
  bottom: "bottom",
};

/** A short state of the dock. */
export interface DockState {
  readonly workspace: string;
  readonly panels: readonly string[];
  readonly active: string | null;
  readonly maximized: boolean;
  readonly floating: readonly string[];
  /** True when the sides fold (a small window). `shown` is the side that shows. */
  readonly folded: boolean;
  readonly shown: FoldSide | null;
}

/** The values of the settings for a new layout: the panel that shows in the bottom area and its height. */
export interface LayoutDefaults {
  readonly bottomPanel?: string;
  readonly bottomPx?: number;
}

export class Dock {
  readonly api: DockviewApi;
  /** The settings for a new layout (the page sets them). If absent, the dock uses the default sizes. */
  defaults: () => LayoutDefaults = () => ({});
  readonly workspaces: Workspaces;
  /** The fold of the sides on a small screen (the shell starts it). */
  readonly fold: DockFold = new DockFold(this);
  readonly #registry: PanelRegistry;
  readonly #title: (id: string) => string;
  /** The current constraints of each group. */
  readonly #limits = new WeakMap<DockviewGroupPanel, string>();
  /** True when the dock built the default layout of the workspace in this load (no stored layout). */
  #built = false;

  /** `title` gives the text of a panel title (the dock names the panel with it for assistive technology). */
  constructor(
    api: DockviewApi,
    registry: PanelRegistry,
    workspaces: Workspaces,
    title: (id: string) => string = (id) => id,
  ) {
    this.api = api;
    this.workspaces = workspaces;
    this.#registry = registry;
    this.#title = title;
    // A reactive proxy of the dock cannot read its private fields: the dock stays a plain object.
    markRaw(this);
  }

  /** Restore the layout of the active workspace, or build its default layout. Then keep each change. */
  start(): void {
    this.#load(this.workspaces.active());
    this.api.onDidLayoutChange(() => {
      this.#limit();
      this.save();
    });
  }

  /** The default layout of the active workspace. */
  reset(): void {
    this.#build(this.workspaces.spec());
    this.save();
  }

  /** Show a different workspace: its layout, or its default layout. */
  switchTo(id: string): void {
    if (!this.workspaces.has(id) || id === this.workspaces.active()) return;
    this.save();
    this.workspaces.setActive(id);
    this.#load(id);
  }

  /** Keep the current layout as a workspace of the person with a name. The result is its ID. */
  saveAs(name: string): string {
    return this.workspaces.add(name, unfolded(this.api.toJSON()));
  }

  /** Remove a workspace of the person. The dock shows the workspace that becomes active. */
  removeWorkspace(id: string): void {
    const active = this.workspaces.active();
    this.workspaces.remove(id);
    if (active === id) this.#load(this.workspaces.active());
  }

  /** Show the workspace state again after an external change (the copy of the studio host). */
  reload(): void {
    this.#load(this.workspaces.active());
  }

  save(): void {
    this.workspaces.setLayout(this.workspaces.active(), unfolded(this.api.toJSON()));
  }

  /** Call the listener after each change of the layout. The result stops it. */
  onChange(listener: () => void): () => void {
    const disposable = this.api.onDidLayoutChange(listener);
    return () => disposable.dispose();
  }

  /** The open panels. */
  panels(): string[] {
    return this.api.panels.map((panel) => panel.id);
  }

  /** The state of the dock for the script API and the tests. */
  state(): DockState {
    return {
      workspace: this.workspaces.active(),
      panels: this.panels(),
      active: this.api.activePanel?.id ?? null,
      maximized: this.api.hasMaximizedGroup(),
      floating: this.api.panels.filter((panel) => panel.api.location.type === "floating").map((panel) => panel.id),
      folded: this.fold.state.folded,
      shown: this.fold.state.shown,
    };
  }

  isOpen(id: string): boolean {
    return this.api.getPanel(id) !== undefined;
  }

  /** The area of a panel: its area in the active workspace, else its default area. */
  areaOf(id: string): PanelArea | undefined {
    const spec = this.#registry.get(id);
    if (spec === undefined) return undefined;
    const lists = this.workspaces.spec().areas;
    const area = (Object.keys(lists) as DockArea[]).find((name) => lists[name]?.includes(spec.id) === true);
    return area ?? spec.area;
  }

  /** Show a panel. An open panel gets the focus. A closed panel opens in its area (when it is available). */
  open(id: string): void {
    if (!this.#registry.available(id)) return;
    const panel = this.api.getPanel(id) ?? this.#add(id, this.areaOf(id) ?? "right");
    this.fold.reveal(id);
    panel?.api.setActive();
    panel?.focus();
    this.save();
  }

  /**
   * A panel that became available after the build of a default layout joins its area with no focus. An example is
   * the agent panel after the studio answers. A stored layout stays as the person left it.
   */
  adopt(id: string): void {
    const area = this.areaOf(id);
    if (!this.#built || this.isOpen(id) || !this.#registry.available(id) || area === undefined) return;
    this.#add(id, area, true);
    this.save();
  }

  /**
   * Open a new copy of a panel that can have many copies ("Inspector 2"), in a split below the panel. Thus two locked
   * inspectors can show at the same time. The result is the ID of the copy, or null.
   */
  openCopy(id: string): string | null {
    const spec = this.#registry.get(id);
    if (spec?.many !== true || !this.#registry.available(id)) return null;
    let copy = 2;
    while (this.isOpen(`${spec.id}${COPY_MARK}${String(copy)}`)) copy += 1;
    const copyId = `${spec.id}${COPY_MARK}${String(copy)}`;
    const base = this.api.getPanel(spec.id);
    const panel =
      base === undefined
        ? this.#add(copyId, this.areaOf(spec.id) ?? "right")
        : this.api.addPanel({ ...this.#base(copyId), position: { referencePanel: base.id, direction: "below" } });
    panel?.api.setActive();
    this.save();
    return copyId;
  }

  /** Close a panel (the Scene view stays). */
  close(id: string | null = this.api.activePanel?.id ?? null): void {
    if (id === null || id === CENTRE_PANEL) return;
    const panel = this.api.getPanel(id);
    if (panel !== undefined) this.api.removePanel(panel);
    this.save();
  }

  /** Maximize the group of the active panel, or restore the maximized group. */
  toggleMaximize(): void {
    if (this.api.hasMaximizedGroup()) this.api.exitMaximizedGroup();
    else if (this.api.activePanel !== undefined) this.api.maximizeGroup(this.api.activePanel);
    this.save();
  }

  /** Float the active panel in the page, or dock a floating panel in its area. */
  toggleFloat(): void {
    const panel = this.api.activePanel;
    if (panel === undefined) return;
    if (panel.api.location.type === "floating") {
      const area = this.areaOf(panel.id) ?? "right";
      this.moveTo(panel.id, area === "floating" ? "right" : area);
      return;
    }
    const width = Math.min(480, Math.round(this.api.width / 2));
    const height = Math.min(360, Math.round(this.api.height / 2));
    this.api.addFloatingGroup(panel, { width, height, x: 48, y: 48 });
    panel.api.setActive();
    this.save();
  }

  /** Move a panel into an area: adjacent to the panels of that area, else adjacent to the Scene view. */
  moveTo(id: string, area: PanelArea): void {
    const panel = this.api.getPanel(id);
    if (panel === undefined || id === CENTRE_PANEL) return;
    if (area === "floating") {
      if (panel.api.location.type !== "floating") this.api.addFloatingGroup(panel);
      this.save();
      return;
    }
    const group = this.#group(area, panel);
    const centre = this.api.getPanel(CENTRE_PANEL);
    if (group !== undefined) panel.api.moveTo({ group, position: "center" });
    else if (centre !== undefined)
      panel.api.moveTo({ group: centre.group, position: area === "centre" ? "center" : PLACES[area] });
    panel.api.setActive();
    this.save();
  }

  /** Give the focus to the active panel of the next group (⌃Tab, F6). */
  next(step = 1): void {
    const groups = this.api.groups.filter((group) => group.activePanel !== undefined);
    if (groups.length === 0) return;
    const at = groups.findIndex((group) => group === this.api.activeGroup);
    const target = groups[(at + step + groups.length) % groups.length];
    target?.activePanel?.api.setActive();
    target?.activePanel?.focus();
  }

  /** Show a workspace: its stored layout, else its default layout. */
  #load(id: string): void {
    this.#built = !this.#restore(this.workspaces.layout(id));
    if (this.#built) {
      this.#build(this.workspaces.spec(id));
      this.save();
    }
    this.#limit();
  }

  /** Build the default layout of a workspace: the centre, the bottom (the full width), then the sides. */
  #build(workspace: WorkspaceSpec): void {
    this.api.clear();
    const listed = (area: DockArea): string[] =>
      (workspace.areas[area] ?? []).filter((id) => this.#registry.available(id));
    const centre = listed("centre");
    if (!centre.includes(CENTRE_PANEL)) centre.push(CENTRE_PANEL);
    for (const area of ["centre", "bottom", "left", "right"] as const) {
      for (const id of area === "centre" ? centre : listed(area)) this.#add(id, area);
    }
    this.#group("left")?.api.setSize({ width: workspace.leftPx ?? LEFT_PX });
    this.#group("right")?.api.setSize({ width: workspace.rightPx ?? RIGHT_PX });
    const defaults = this.defaults();
    const bottom = Math.max(bottomHeight(this.api.height, workspace.bottomShare), defaults.bottomPx ?? 0);
    this.#group("bottom")?.api.setSize({ height: Math.min(bottom, Math.round(this.api.height * 0.6)) });
    // The first panel of each area shows (the setting can name the bottom panel). The centre is last, so it is active.
    const shown = (area: DockArea): string | undefined =>
      area === "bottom" && defaults.bottomPanel !== undefined && listed(area).includes(defaults.bottomPanel)
        ? defaults.bottomPanel
        : (area === "centre" ? centre : listed(area))[0];
    for (const area of ["bottom", "left", "right", "centre"] as const) {
      const first = shown(area);
      if (first !== undefined) this.api.getPanel(first)?.api.setActive();
    }
  }

  #base(id: string): {
    id: string;
    component: string;
    tabComponent: string;
    title: string;
    renderer?: "always";
  } {
    const keep = KEEP_MOUNTED.has(id) ? { renderer: "always" as const } : {};
    return { id, component: PANEL_COMPONENT, tabComponent: TAB_COMPONENT, title: this.#title(id), ...keep };
  }

  /** Add a panel in an area: adjacent to a panel of the area, else in a new group of the area. */
  #add(id: string, area: PanelArea, inactive = false): IDockviewPanel | undefined {
    if (this.#registry.get(id) === undefined) return undefined;
    const base = { ...this.#base(id), ...(inactive ? { inactive } : {}) };
    if (area === "floating") return this.api.addPanel({ ...base, floating: true });
    const group = area === "centre" ? this.api.getPanel(CENTRE_PANEL)?.group : this.#group(area);
    if (group !== undefined) return this.api.addPanel({ ...base, position: { referenceGroup: group } });
    if (area === "centre" || !this.isOpen(CENTRE_PANEL)) return this.api.addPanel(base);
    // The bottom area spans the full window. The sides are adjacent to the Scene view.
    if (area === "bottom") return this.api.addPanel({ ...base, position: { direction: "below" } });
    return this.api.addPanel({ ...base, position: { referencePanel: CENTRE_PANEL, direction: area } });
  }

  /** The docked group that holds a panel of an area (not the panel `except`). */
  #group(area: PanelArea, except?: IDockviewPanel): DockviewGroupPanel | undefined {
    return this.api.groups.find(
      (group) =>
        group.api.location.type === "grid" &&
        group.panels.some((panel) => panel !== except && this.areaOf(panel.id) === area),
    );
  }

  /** Give each docked group the smallest size of the area of its panels (only when it changes). */
  #limit(): void {
    for (const group of this.api.groups) {
      if (group.api.location.type !== "grid") continue;
      const area = group.panels.map((panel) => this.areaOf(panel.id)).find((item) => item !== undefined);
      const limits = LIMITS[area ?? "centre"];
      const key = JSON.stringify(limits);
      if (this.#limits.get(group) === key) continue;
      this.#limits.set(group, key);
      group.api.setConstraints(limits);
    }
  }

  /** Restore a stored layout. The result is false when there is none or the dock cannot read it. */
  #restore(layout: unknown): boolean {
    if (layout === null || layout === undefined) return false;
    try {
      this.api.fromJSON(layout as Parameters<DockviewApi["fromJSON"]>[0]);
    } catch {
      return false;
    }
    if (!this.isOpen(CENTRE_PANEL)) return false;
    // A panel of the stored layout that the registry does not know closes. The others get the title of this locale.
    for (const panel of [...this.api.panels]) {
      if (this.#registry.get(panel.id) === undefined) this.api.removePanel(panel);
      else {
        panel.api.setTitle(this.#title(panel.id));
        if (KEEP_MOUNTED.has(panel.id)) panel.api.setRenderer("always");
      }
    }
    return true;
  }
}
