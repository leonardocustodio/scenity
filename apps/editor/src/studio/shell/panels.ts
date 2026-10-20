// SPDX-License-Identifier: Apache-2.0
/**
 * The panel registry of the editor window. Each panel has an ID, a title, an icon, a default area, its keys and its
 * key context. The dock, the Window menu and the `panel.open.<id>` commands read the registry. A part of the page
 * gives the content of a panel later (`setContent`). The dock shows the panel from the start, and the content comes
 * when its code has loaded.
 */
import type { Component } from "vue";
import { markRaw, shallowReactive, shallowRef } from "vue";
import {
  Activity,
  BadgeCheck,
  Bot,
  Clapperboard,
  Code,
  Cpu,
  Boxes,
  FileClock,
  FileCog,
  Film,
  GalleryHorizontal,
  FolderTree,
  Gamepad2,
  Gauge,
  Hammer,
  ListTodo,
  ListVideo,
  Images,
  Scale,
  ShieldCheck,
  GitBranch,
  GitPullRequestArrow,
  History,
  Keyboard,
  Layers2,
  ListChecks,
  ListTree,
  Logs,
  StickyNote,
  Tags,
  Timer,
  SunMedium,
  Search,
  Package,
  PackageOpen,
  Palette,
  PersonStanding,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  SquareTerminal,
  TriangleAlert,
  View,
  Workflow,
} from "lucide-vue-next";

/** The place of a panel in the default layout. */
export type PanelArea = "left" | "centre" | "right" | "bottom" | "floating";

export interface PanelSpec {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  readonly icon: Component;
  readonly area: PanelArea;
  /** The keys of `panel.open.<id>`. */
  readonly keys?: readonly string[];
  /** A menu of the menu bar that also has `panel.open.<id>` (the Window menu has each panel). */
  readonly menu?: string;
  /** The key context of the content (pageKeys.ts): "dock" for the panels of the bottom area. */
  readonly keyContext?: string;
  /** False: the panel has no close button (the Scene view). */
  readonly closable?: boolean;
  /** True: the panel can have many copies ("Inspector 2"). Each copy shows the same content. */
  readonly many?: boolean;
  /** False when the panel is not available (the Window menu does not show it, and the dock does not open it). */
  readonly when?: () => boolean;
}

/** True when the studio host serves the window (its `/health` tells this). The agent panel needs it. */
export const studioHost = shallowRef(false);

/** The separator of the copy number in the ID of a copy of a panel (`inspector#2`). */
export const COPY_MARK = "#";

/** The title of a panel or of a copy ("Inspector 2"), with the translate function of the page. */
export function panelTitle(
  registry: PanelRegistry,
  id: string,
  translate: (message: string, args?: Record<string, string | number>) => string,
): string {
  const spec = registry.get(id);
  if (spec === undefined) return id;
  const { copy } = copyOf(id);
  const title = translate(spec.title);
  return copy === 1 ? title : translate("panel-copy", { title, copy });
}

/** The ID of the panel of a copy, and the number of the copy (1 for the panel itself). */
export function copyOf(id: string): { readonly base: string; readonly copy: number } {
  const at = id.lastIndexOf(COPY_MARK);
  const copy = at < 0 ? 1 : Number(id.slice(at + 1));
  return at < 0 || !Number.isInteger(copy) || copy < 2 ? { base: id, copy: 1 } : { base: id.slice(0, at), copy };
}

/** The content of a panel: a Vue component with its props, in a host element with an optional ID. */
export interface PanelContent {
  readonly component: Component;
  readonly props?: Readonly<Record<string, unknown>>;
  /** The ID of the host element (and its test ID). */
  readonly hostId?: string;
  /** True: plain DOM content with its own styles (the Scene view), with no base styles of the panels. */
  readonly plain?: boolean;
}

/** The core panels of the editor window. */
export const CORE_PANELS: readonly PanelSpec[] = [
  { id: "scene.view", title: "panel-scene-view", icon: View, area: "centre", keys: ["Mod+1"], closable: false },
  // The scene through a document camera in the player path.
  { id: "game.view", title: "panel-game-view", icon: Gamepad2, area: "centre", keys: ["Mod+2"], keyContext: "dock" },
  { id: "inspector", title: "panel-inspector", icon: SlidersHorizontal, area: "right", keys: ["Mod+3"], many: true },
  { id: "hierarchy", title: "panel-hierarchy", icon: ListTree, area: "left", keys: ["Mod+4"], keyContext: "hierarchy" },
  // The notes of the scene (its note file and its note entities).
  { id: "notes", title: "panel-notes", icon: StickyNote, area: "left", keyContext: "dock" },
  // The tags and the pick layers of the scene.
  { id: "tags", title: "panel-tags", icon: Tags, area: "left", keyContext: "dock" },
  // The scenes of the project (the start screen in the dock).
  { id: "scenes", title: "panel-scenes", icon: Clapperboard, area: "left", keyContext: "dock" },
  { id: "project", title: "panel-project", icon: FolderTree, area: "bottom", keys: ["Mod+5"], keyContext: "dock" },
  { id: "timeline", title: "panel-timeline", icon: FileClock, area: "bottom", keys: ["Mod+6"], keyContext: "dock" },
  { id: "rules", title: "panel-rules", icon: ScrollText, area: "bottom", keyContext: "dock" },
  { id: "material", title: "panel-material", icon: Palette, area: "bottom", keyContext: "dock" },
  // The look of the whole scene: the presets, the environment maps, the environment, the lights.
  { id: "lighting", title: "panel-lighting", icon: SunMedium, area: "right", keyContext: "dock" },
  // The variants of the scene (its override layers) and the compare wipe.
  { id: "variants", title: "panel-variants", icon: Layers2, area: "right", keyContext: "dock" },
  // The rig profile, the bone map and the clip source of a character.
  { id: "character", title: "panel-character", icon: PersonStanding, area: "right", keyContext: "dock" },
  // The clips of a model. A drag onto the timeline adds an animation key, and Preview plays a clip in the view.
  { id: "clips", title: "panel-clips", icon: ListVideo, area: "left", keyContext: "dock" },
  // The states, the transitions, the parameters and the layers of an animator.
  { id: "animator", title: "panel-animator", icon: Workflow, area: "bottom", keyContext: "dock" },
  // The states of the simulations at the time of the clock, and a recorded stream.
  { id: "simulation", title: "panel-simulation", icon: Gauge, area: "bottom", keyContext: "dock" },
  // The Build window: the build, its report and the size budgets of the entries.
  { id: "build", title: "panel-build", icon: Package, area: "right", keyContext: "dock" },
  // The player preview and the embed snippets.
  { id: "embed", title: "panel-embed", icon: Code, area: "bottom", keyContext: "dock" },
  // The shots, the baselines of the platform and the verify job.
  { id: "baselines", title: "panel-baselines", icon: Images, area: "bottom", keyContext: "dock" },
  // The render queue of sheets and clips, and its outputs.
  { id: "renderQueue", title: "panel-renderQueue", icon: Film, area: "bottom", keyContext: "dock" },
  // The frame index of the project (by sequence, camera and time).
  { id: "frameIndex", title: "panel-frameIndex", icon: GalleryHorizontal, area: "bottom", keyContext: "dock" },
  // The frame statistics, the cost of each entity, and the render switches.
  { id: "performance", title: "panel-performance", icon: Cpu, area: "bottom", keyContext: "dock" },
  // The bench runner: the budgets of the last run and the trend of the runs.
  { id: "bench", title: "panel-bench", icon: Timer, area: "bottom", keyContext: "dock" },
  // The quality budgets adjacent to the values of the last bench.
  { id: "budgets", title: "panel-budgets", icon: Gauge, area: "bottom", keyContext: "dock" },
  // The build state of each asset, a run of the build, the build settings and the levels of an asset.
  { id: "assetBuild", title: "panel-asset-build", icon: Hammer, area: "bottom", keyContext: "dock" },
  // The licence policy of the project and its rights records.
  { id: "rights", title: "panel-rights", icon: Scale, area: "right", keyContext: "dock" },
  // The review queue of each approval role.
  { id: "approvals", title: "panel-approvals", icon: BadgeCheck, area: "bottom", keyContext: "dock" },
  // The result of the release gate for each asset, with the fixes.
  { id: "release", title: "panel-release", icon: ShieldCheck, area: "bottom", keyContext: "dock" },
  // The GLB export of a scene, with the glTF validator.
  { id: "export", title: "panel-export", icon: PackageOpen, area: "bottom", keyContext: "dock" },
  // Each run of a command as a line (the Review workspace shows it).
  { id: "activity", title: "panel-activity", icon: Activity, area: "bottom", keyContext: "dock" },
  // The log of the page, the worker, the server, the plugins, the jobs and the agent tools.
  { id: "console", title: "panel-console", icon: Logs, area: "bottom", keys: ["Mod+Shift+C"], keyContext: "dock" },
  // The problems of the rules, the assets, the rights, the schemas, the budgets, the plugins and the build.
  {
    id: "problems",
    title: "panel-problems",
    icon: TriangleAlert,
    area: "bottom",
    keys: ["Mod+Shift+M"],
    keyContext: "dock",
  },
  // The full form of the search box (⌘⇧K is the command `search.window`).
  { id: "search", title: "panel-search", icon: Search, area: "bottom", keyContext: "dock" },
  // The undo stack with the actors and the change sets.
  { id: "history", title: "panel-history", icon: History, area: "bottom", keys: ["Mod+Shift+H"], keyContext: "dock" },
  // The change sets of the agents that wait for review.
  { id: "review", title: "panel-review", icon: GitPullRequestArrow, area: "bottom", keyContext: "dock" },
  // The plugins of the project.
  { id: "plugins", title: "panel-plugins", icon: Boxes, area: "bottom", menu: "file", keyContext: "dock" },
  // The jobs of the dev server and of the studio host, with their outputs, and the runs of the project.
  { id: "jobs", title: "panel-jobs", icon: ListTodo, area: "bottom", keyContext: "dock" },
  // The changes with semantic diffs, the commit by the owner, the branches and the worktrees.
  { id: "vcs", title: "panel-vcs", icon: GitBranch, area: "bottom", keys: ["Mod+Shift+G"], keyContext: "dock" },
  // The instructions of the agents of the project (AGENTS.md, CLAUDE.md, the skills).
  {
    id: "instructions",
    title: "panel-instructions",
    icon: ScrollText,
    area: "right",
    menu: "agent",
    keyContext: "dock",
    when: () => studioHost.value,
  },
  // The background tasks of the agents of the project.
  {
    id: "tasks",
    title: "panel-tasks",
    icon: ListChecks,
    area: "bottom",
    menu: "agent",
    keyContext: "dock",
    when: () => studioHost.value,
  },
  // The terminals of the project (Claude Code and the shell) on the studio host.
  {
    id: "terminal",
    title: "panel-terminal",
    icon: SquareTerminal,
    area: "bottom",
    keys: ["Ctrl+`"],
    keyContext: "dock",
    when: () => studioHost.value,
  },
  // The agent sessions of the studio host.
  {
    id: "agent",
    title: "panel-agent",
    icon: Bot,
    area: "right",
    keyContext: "agent",
    when: () => studioHost.value,
  },
  // Each field of the project file as a form from its schema.
  {
    id: "projectSettings",
    title: "panel-project-settings",
    icon: FileCog,
    area: "bottom",
    menu: "file",
    keyContext: "dock",
  },
  // The key map on a keyboard picture.
  {
    id: "shortcuts",
    title: "panel-shortcuts",
    icon: Keyboard,
    area: "bottom",
    menu: "file",
    keyContext: "dock",
  },
  {
    id: "preferences",
    title: "panel-preferences",
    icon: Settings2,
    area: "bottom",
    keys: ["Mod+,"],
    menu: "file",
    keyContext: "dock",
  },
];

/** The icon of a panel with no spec (a plugin panel that was removed). */
export const UNKNOWN_PANEL_ICON: Component = Boxes;

/** The panels of the editor window and their contents. */
export class PanelRegistry {
  readonly #specs = shallowReactive(new Map<string, PanelSpec>());
  readonly #contents = shallowReactive(new Map<string, PanelContent>());

  constructor(specs: readonly PanelSpec[] = CORE_PANELS) {
    for (const spec of specs) this.register(spec);
    // A reactive proxy of the registry cannot read its private fields: the registry stays a plain object.
    markRaw(this);
  }

  /** Add a panel. A panel with the same ID gets the new spec. The result removes it. */
  register(spec: PanelSpec): () => void {
    this.#specs.set(spec.id, markRaw({ ...spec }));
    return () => {
      this.#specs.delete(spec.id);
      this.#contents.delete(spec.id);
    };
  }

  /** The panels in the order of registration. */
  list(): PanelSpec[] {
    return [...this.#specs.values()];
  }

  /** The spec of a panel or of a copy of it. */
  get(id: string): PanelSpec | undefined {
    return this.#specs.get(copyOf(id).base);
  }

  /** True when the panel is in the registry and available. */
  available(id: string): boolean {
    const spec = this.get(id);
    return spec !== undefined && spec.when?.() !== false;
  }

  /** Give a panel its content (or remove it with null). */
  setContent(id: string, content: PanelContent | null): void {
    if (content === null) this.#contents.delete(id);
    else this.#contents.set(id, markRaw({ ...content, component: markRaw(content.component) }));
  }

  content(id: string): PanelContent | undefined {
    return this.#contents.get(copyOf(id).base);
  }
}
