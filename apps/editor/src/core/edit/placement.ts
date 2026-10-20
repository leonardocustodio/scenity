// SPDX-License-Identifier: Apache-2.0
/**
 * "Save placement": the place values of the lab go into the runtime source through `labs tune-apply`, the tune-to-code
 * path of the workbench. The place values are the `room.props.*` tune values and the paths of the plugin
 * (`editorPrefixes`). The prop places and the light go into the scene document of the room. First the dry run shows
 * the lines that change, then the real apply occurs. In the workbench, the host runs both (a run of the Runs tab) and
 * returns the output. A lab page without the workbench shows the commands.
 */
import { tuneText } from "@scenity/runtime-dev";
import type { PropGroup } from "../editor/groups";
import type { SnapScene, SnapTarget } from "../editor/snapTypes";
import { editorPlugin } from "../plugin";
import type { LocalBox } from "./footprint";
import type { PropPlace } from "./placeDrag";

/** The places of the scene of a plugin (`EditorPlugin.placement`): the room kit of the scene editor. */
export interface EditorPlacement {
  /** The tune path prefixes that the editor moves and "Save placement" writes, in addition to the prop places. */
  readonly prefixes: readonly string[];
  /** The current snap targets of the scene. */
  snapTargets(scene: SnapScene): SnapTarget[];
  /** The warnings of a prop at a place: the obstacles that its floor box enters (`home`: its place in the code). */
  warnings(local: LocalBox | null, place: PropPlace, home: PropPlace | null): string[];
  /** The built-in groups: the props that stand on another prop. */
  readonly groups: readonly PropGroup[];
  /** The named ends of a measure: a name → the work point that it identifies. */
  readonly measureEnds: Readonly<Record<string, string>>;
}

/** The prefix of the tune paths of the prop places. */
export const PLACE_PREFIX = "room.props.";

/**
 * The prefixes of the tune paths that the scene editor moves and "Save placement" writes. They are the prop places and
 * the paths of the plugin (`EditorPlugin.placement.prefixes`). Examples are the bends of the cable routes, the hand
 * targets of the pose families and the light.
 */
export function editorPrefixes(): readonly string[] {
  return [PLACE_PREFIX, ...editorPlugin().placement.prefixes];
}

/** The place values of the tune values (the other tune values stay out of a placement). */
export function placementValues(tunes: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tunes).filter(([path]) => editorPrefixes().some((prefix) => path.startsWith(prefix))),
  );
}

/**
 * The tune values after a real apply of `applied`. The function removes each place value that the code holds after
 * the apply. Thus the URL has no tune value for it, and a new page shows the same place from the code. A value that
 * changed after the apply stays.
 */
export function withoutApplied(
  tunes: Readonly<Record<string, number>>,
  applied: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(Object.entries(tunes).filter(([path, value]) => applied[path] !== value));
}

/** The command of a placement for a terminal in the repository root (a lab page without the workbench). */
export function placementCommand(values: Readonly<Record<string, number>>, dry: boolean): string {
  return `bun run labs tune-apply "${tuneText(values)}"${dry ? " --dry" : ""}`;
}

/** The answer of the host to a placement (`placementResult` of the bridge). */
export interface PlacementView {
  readonly run: string | null;
  readonly dry: boolean;
  /** "running" until the answer, then the status of the run ("passed", "failed", …). */
  readonly status: string;
  readonly output: string;
}

/** Read the answer of the host; null for a value that is not an answer. */
export function placementAnswer(value: unknown): PlacementView | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.dry !== "boolean" || typeof item.status !== "string" || typeof item.output !== "string") return null;
  return {
    run: typeof item.run === "string" ? item.run : null,
    dry: item.dry,
    status: item.status,
    output: item.output,
  };
}

/** The lines of a dry run that change the source: `file:line  path  before → after`. */
export function changedLines(output: string): string[] {
  return output.split("\n").filter((line) => line.includes(" → "));
}
