// SPDX-License-Identifier: Apache-2.0
/**
 * The workspaces of the editor window: each workspace is a default layout for a kind of work. A workspace lists its
 * panels by area in the order of their tabs. The dock does not show a panel that the registry does not have (for
 * example, the panel of a plugin that is not installed). The Scene view is in each workspace: it holds the canvas.
 */
import type { PanelArea } from "./panels";

export type DockArea = Exclude<PanelArea, "floating">;

export interface WorkspaceSpec {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  /** The panels of each area, the first one shows in its group. */
  readonly areas: Readonly<Partial<Record<DockArea, readonly string[]>>>;
  /** The widths of the side areas (CSS pixels) and the share of the bottom area. */
  readonly leftPx?: number;
  readonly rightPx?: number;
  readonly bottomShare?: number;
}

/** The built-in workspaces. */
export const WORKSPACES: readonly WorkspaceSpec[] = [
  {
    id: "layout",
    title: "workspace-layout",
    areas: {
      left: ["hierarchy", "scenes", "notes"],
      centre: ["scene.view", "game.view"],
      right: ["inspector", "material", "lighting", "variants", "agent"],
      bottom: ["project", "console", "problems", "timeline", "rules", "review", "jobs", "preferences"],
    },
  },
  {
    id: "animate",
    title: "workspace-animate",
    areas: {
      left: ["hierarchy", "clips"],
      centre: ["scene.view", "game.view"],
      right: ["inspector", "agent"],
      bottom: ["timeline", "animator", "character", "project"],
    },
    bottomShare: 0.45,
  },
  {
    id: "assets",
    title: "workspace-assets",
    areas: {
      left: ["project"],
      centre: ["scene.view"],
      right: ["inspector", "material"],
      bottom: ["importQueue", "rights", "assetBuild", "approvals", "assetSources"],
    },
    leftPx: 520,
  },
  {
    id: "review",
    title: "workspace-review",
    areas: {
      left: ["hierarchy"],
      centre: ["scene.view"],
      right: ["inspector", "agent"],
      bottom: ["review", "history", "activity", "vcs", "tasks", "rules"],
    },
  },
  {
    id: "build",
    title: "workspace-build",
    areas: {
      centre: ["game.view", "scene.view"],
      right: ["build", "performance"],
      bottom: ["baselines", "renderQueue", "frameIndex", "jobs", "problems", "rules"],
    },
  },
];

/** The default workspace. */
export const DEFAULT_WORKSPACE = "layout";

/** The workspace of an ID, else the default one. */
export function workspaceOf(id: string): WorkspaceSpec {
  const [first] = WORKSPACES;
  const found = WORKSPACES.find((item) => item.id === id) ?? first;
  if (found === undefined) throw new Error("The editor has no workspaces.");
  return found;
}
