// SPDX-License-Identifier: Apache-2.0
/**
 * The host face of a plugin: the MCP tools, the lines of the context packet,
 * the runs and the surfaces of the built-in project and the paths that the host core reads. The host core
 * holds no domain names: a plugin gives them. The host loads the host face of each plugin of the project
 * (src/plugins.ts): the `scenity.host` field of the package.json of the plugin names the module, and its default
 * export is the face. A plugin imports this module (`@scenity/workbench-host/plugin`) for the interface and the tool
 * kit. The page adds its own tools and lines through the bridge (`tools`, `contextLines` of `@scenity/bridge`).
 */
import type { FrameIndexSource } from "@scenity/labs-platform/indexSource";
import type { RunSpec, WorkbenchSettings } from "@scenity/scene";
import type { PromoteFiles } from "./promote";
import type { GateCheck } from "./stopGate";
import type { SurfacePort } from "./tools/context";
import type { ToolDef } from "./tools/kit";
import type { PickedTarget } from "./tools/picked";

export type { PromoteFiles } from "./promote";
export type { GateCheck } from "./stopGate";
export type { PickedTarget } from "./tools/picked";
export type { SurfacePort, ToolContext } from "./tools/context";
export * from "./tools/kit";
export { checkLines, failureLine } from "./tools/checkReport";
export { commandListTool, commandRunTool, editLines, opLine, type CommandToolSpec } from "./tools/edit";
/** The tune lines of the lab (with `lab_tunes` and the `labs tune-apply` text) for a lab tool spec. */
export { tuneLines as labTuneLines } from "./tools/tune";
export { goToFrame, timeInput, whereInput } from "./tools/frame";
export { measureDistance, measureInput } from "./tools/measure";
export { withoutDenied } from "./denylist";
export type { RunPreset, RunSpec } from "@scenity/scene";
export { INDEX_CAPABILITY, SCENE_CAPABILITY } from "./protocol";

/** One surface of a project manifest (`workbench.surfaces` of `scenity.project.json`). */
export type HostSurface = WorkbenchSettings["surfaces"][number];

/** The lines of the context packet that come from a plugin. Each function reads a plain report of the lab bridge. */
export interface HostContextLines {
  /**
   * The rows of the scene on screen (for example the members), from the inspect report of the frame. When no
   * plugin gives them, the host shows the entities of the report (contextRows.ts).
   */
  members?(report: unknown): string[];
  /** The lines of the lab state under the members (the look of the scene). */
  state?(state: unknown): string[];
  /** The short lab state that `lab_state` gives as JSON. */
  summary?(state: unknown): unknown;
}

/**
 * The runs of a plugin: the runs by ID (a command line, or a run with its output folder, kind, GPU use and
 * buttons) and the stop gate (a run ID or a command line). The manifest runs of a project come after them.
 */
export interface HostRuns {
  readonly commands: Readonly<Record<string, string | RunSpec>>;
  readonly gate?: string;
}

/** The paths of a plugin: its file maps and the tune paths that the host lets a run write. */
export interface HostPaths {
  /** The lines of the files behind a picked item (`lab_pick`, the picked block of the packet). */
  picked?(checkout: string, target: PickedTarget): string[];
  /** The tune paths that "Save placement" may write (`labs tune-apply`). */
  readonly placement?: readonly RegExp[];
  /** The rule of one pair of a layout tune text (`path:value`) that "Save layout as" may write. */
  readonly layoutPair?: RegExp;
  /** The folders and the scene of a promote, from the root of the checkout (promote.ts `PromoteFiles`). */
  readonly promote?: PromoteFiles;
  /** The script of the import job of a dropped file, from the root of the checkout (imports.ts). */
  readonly importJob?: string;
}

/** The host face of a plugin. */
export interface HostPlugin {
  readonly id: string;
  /** The MCP tools of the plugin. A tool with the name of a core tool replaces the core tool. */
  readonly tools: readonly ToolDef[];
  readonly contextLines: HostContextLines;
  readonly runs: HostRuns;
  readonly paths: HostPaths;
  /** The frame index source of the built-in project (a checkout with no project manifest). */
  readonly indexSource?: FrameIndexSource;
  /** The surfaces of the built-in project: their IDs, labels, capabilities and order. */
  readonly surfaces?: readonly HostSurface[];
  /**
   * The fast check of the `Stop` gate of a session in a frame (the shadow) at the URL of the scene surface.
   * Without it, the gate of a session runs the stop gate run of the project.
   */
  gateCheck?(port: SurfacePort, url: string | null): Promise<GateCheck>;
  /** The sequence that the forms of the dock start with. Without it, the first sequence of the project. */
  readonly defaultSequence?: string;
  /**
   * The examples of the project for core tools: a tool name → a sentence that the host adds to the
   * description of that core tool (for example the cameras, the items and the takes of the project).
   */
  readonly toolNotes?: Readonly<Record<string, string>>;
}

/** Define the host face of a plugin. The function only gives the types. */
export function defineHostPlugin(plugin: HostPlugin): HostPlugin {
  return plugin;
}
