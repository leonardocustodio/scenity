// SPDX-License-Identifier: Apache-2.0
/**
 * The command parts of the lab page. The generic kit is in `@scenity/editor-core`: the command shape,
 * `defineCommand`, the check of the arguments, the selection rules and the helpers. This module gives the lab parts of
 * the state and of the host: the marks, the cameras, the groups, the scratch props and the tools of the page. A plugin
 * adds its own parts (`EditorPlugin.registerCommands`). commands.ts holds the registry. No Vue import: the tests and
 * the tools read it.
 */
import {
  defineCommands,
  type Command as CoreCommand,
  type CommandHost as CoreCommandHost,
  type CommandOutcome as CoreCommandOutcome,
  type CommandState as CoreCommandState,
} from "@scenity/editor-core";
import type { SelectTarget } from "@scenity/runtime-dev";
import type { CameraName, NamedView } from "../cameras";
import type { PropPlace } from "../edit/placeDrag";
import type { OnionChange, OnionState } from "./onion";
import type { PropGroup } from "./groups";
import type { EditOp } from "./ops";

export {
  CommandError,
  grid,
  NO_RULE,
  num,
  numberArg,
  parseArgs,
  rulePasses,
  ruleText,
  textArg,
  type Args,
  type ArgSpec,
  type CommandKind,
  type CommandListing,
  type SelectionRule,
} from "@scenity/editor-core";

/** The tool of the source op of "Save placement". The host runs it after the `placement` bridge event. */
export const PLACEMENT_TOOL = "labs tune-apply";

/** What the commands of the lab read: the base state of the editor core and the marks, the camera and the groups. */
export interface CommandState extends CoreCommandState<SelectTarget> {
  /** True while the owner draws marks. */
  readonly marking: boolean;
  /** The number of marks on the frame. */
  readonly marks: number;
  /** The current camera (the view of `camera.save` and `camera.bookmark`). If absent, the camera commands fail. */
  readonly camera?: () => CameraNow;
  /** The named groups (groups.ts): the built-in groups and the groups of the owner. If absent, the built-in groups. */
  readonly groups?: () => readonly PropGroup[];
}

/** The solo and hide of the panes (editor/useHide.ts), for the commands `view.hide`, `.solo` and `.showAll`. */
export interface HideHost {
  /** Hide the items in the focused pane (all: in every pane). Returns the hide state after the change. */
  hide(targets: readonly SelectTarget[], all: boolean): unknown;
  /** Show only the items in the focused pane (all: in every pane). Returns the hide state after the change. */
  solo(targets: readonly SelectTarget[], all: boolean): unknown;
  /** Show every item again in the focused pane (all: in every pane). Returns the hide state after the change. */
  showAll(all: boolean): unknown;
}

/** The groups of the owner in the URL (editor/useGroups.ts), for the commands `group.save` and `group.remove`. */
export interface GroupsHost {
  /** Keep a group of the owner (a new name, or a new list for a known name). Returns the groups after the change. */
  save(name: string, props: readonly string[]): unknown;
  /** Remove a group of the owner. Returns false for an unknown name. */
  remove(name: string): boolean;
}

/** The view of the focused pane (else of the main camera), the named cameras and the bookmarks of the URL. */
export interface CameraNow {
  readonly view: NamedView;
  readonly names: readonly string[];
  readonly bookmarks: readonly string[];
}

/** The onion skin of the page (editor/useOnion.ts), for the command `view.onion`. */
export interface OnionHost {
  /** Change the state. If `on` is absent, the state toggles. Returns the state after the change. */
  set(change: OnionChange): OnionState;
}

/** The camera bookmarks of the URL (`views=`, editor/useCameraSave.ts). */
export interface BookmarkHost {
  /** Keep the current view under a name. Returns the view text. */
  bookmark(name: string): string;
  /** Open a bookmark in the focused pane (else in the main camera). Returns false for an unknown name. */
  recall(name: string): boolean;
}

/**
 * The measure tool of the page (editor/useMeasure.ts) for the commands `measure.*`. It starts the two picks, measures
 * between two ends (points or items) and clears the measurements.
 */
export interface MeasureHost {
  start(): unknown;
  between(from: string, to: string): Promise<unknown>;
  /** Clear the measurements and a pick that waits. Returns the number of the measurements that it removed. */
  clear(): number;
}

/**
 * The layout checks of the page (editor/layout.ts) for the command `layout.check`. `check` gives the current report.
 * `show` opens its status in the lab page.
 */
export interface LayoutHost {
  check(): unknown;
  show(): void;
}

/** The key light handle of the page (editor/useLight.ts), for the command `light.show`. */
export interface LightHost {
  /** Show the handle (true), hide it (false) or toggle it (null). Returns the state after the change. */
  show(on: boolean | null): boolean;
}

/** The functions of the lab page that the view commands use (useCommands.ts gives them). */
export interface CommandHost extends CoreCommandHost<SelectTarget> {
  /** A named camera: of the focused pane, else of the main camera (as the keys 1 to 9). */
  openCamera(name: CameraName): void;
  setMarking(on: boolean): void;
  clearMarks(): void;
  ask(text: string): unknown;
  scratchPlace(id: string): PropPlace | null;
  moveScratch(id: string, place: PropPlace): void;
  /** Duplicate a scratch prop and select the copy. Returns the ID of the copy, or null. */
  duplicateScratch(id: string): string | null;
  /** Clear the selection and take the scratch prop out. */
  removeScratch(id: string): void;
  promoteScratch(id: string, dry: boolean): boolean;
  /** The measure tool. If it is absent, the commands `measure.*` fail. */
  readonly measure?: MeasureHost;
  /** The layout checks. If they are absent, the command `layout.check` fails. */
  readonly layout?: LayoutHost;
  /** The camera bookmarks. If they are absent, the commands `camera.bookmark` and `camera.recall` fail. */
  readonly bookmarks?: BookmarkHost;
  /** The onion skin. If it is absent, the command `view.onion` fails. */
  readonly onion?: OnionHost;
  /** The key light handle. If it is absent, the command `light.show` fails. */
  readonly light?: LightHost;
  /** The solo and hide of the panes. If absent, the commands `view.hide`, `.solo` and `.showAll` fail. */
  readonly hide?: HideHost;
  /** The groups of the owner. If they are absent, the commands `group.save` and `group.remove` fail. */
  readonly groups?: GroupsHost;
}

/** The result of a command of the lab: edit ops, or a function that runs on the page. */
export type CommandOutcome = CoreCommandOutcome<EditOp, CommandHost>;

/** A command of the lab. A command of a plugin can read more state parts and use more host parts. */
export type Command = CoreCommand<CommandState, CommandHost, EditOp>;

/** Define the commands of a module of the lab (with `defineCommands` of the editor core). */
export function labCommands(commands: readonly Command[]): readonly Command[] {
  return defineCommands(commands);
}

/** The groups of the generic commands of the lab. A plugin puts these groups in the order of its palette. */
export type CoreCommandGroup =
  | "prop"
  | "scratch"
  | "snap"
  | "group"
  | "light"
  | "view"
  | "hide"
  | "camera"
  | "onion"
  | "measure"
  | "placement"
  | "proposal";

export type CoreCommands = Readonly<Record<CoreCommandGroup, readonly Command[]>>;
