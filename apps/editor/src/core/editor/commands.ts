// SPDX-License-Identifier: Apache-2.0
/**
 * The command registry of the scene editor. Each editor action is a named command with a title, a key, an argument
 * schema, a selection rule and a build function. The palette (CommandPalette.vue), the keys and the buttons of the lab
 * page use this one registry. The script API (`commands`, `command`) and the tools of the workbench host
 * (`scene_commands`, `scene_command`) use it too. Thus Claude can do what the owner can do.
 *
 * The registry is `createCommandRegistry` of `@scenity/editor-core`. The plugin registers the commands of its editor
 * (`EditorPlugin.registerCommands`): the generic commands of the lab (prop, scratch, snap, group, light, view, hide,
 * camera, onion, measure, placement and proposal commands, which this module gives it) and its own, in the order of the
 * palette. A command gives one of two results:
 *
 * - `edit`: edit ops (ops.ts: tune, event and source ops). The page applies them through the editor as one step of the
 *   history (useEditor.ts), or keeps them as a proposal (useCommands.ts). An edit is an input of the frame.
 * - `view`: a function that runs immediately on the page. It is not a step of the edit history and never a proposal.
 *   Examples: the selection, the camera, the marks, the ask, undo and redo (they move in the history), the proposals,
 *   and the scratch list (its changes are steps of the history through its channel, editHistory.ts).
 *
 * The module is pure: it reads a state and gives a result. No Vue import: the tests and the tools read it.
 */
import { createCommandRegistry, type CommandRegistry } from "@scenity/editor-core";
import { editorPlugin, type EditorPlugin } from "../plugin";
import { CAMERA_COMMANDS } from "./cameraCommands";
import type {
  Args,
  Command,
  CommandHost,
  CommandListing,
  CommandOutcome,
  CommandState,
  CoreCommands,
} from "./commandKit";
import { GROUP_COMMANDS } from "./groupCommands";
import { HIDE_COMMANDS } from "./hideCommands";
import { LIGHT_COMMANDS } from "./lightCommands";
import { MEASURE_COMMANDS } from "./measureCommands";
import { ONION_COMMANDS } from "./onionCommands";
import type { EditOp } from "./ops";
import { PROP_COMMANDS, SCRATCH_COMMANDS } from "./propCommands";
import { SNAP_COMMANDS } from "./snapCommands";
import { PLACEMENT_COMMANDS, PROPOSAL_COMMANDS, VIEW_COMMANDS } from "./viewCommands";

export * from "./commandKit";
export { propSlots } from "./propCommands";

/** The registry of the lab page. */
export type LabCommandRegistry = CommandRegistry<CommandState, CommandHost, EditOp>;

/** The generic commands of the lab, by group: the plugin puts them in the order of its palette. */
export function coreCommands(): CoreCommands {
  return {
    prop: PROP_COMMANDS,
    scratch: SCRATCH_COMMANDS,
    snap: SNAP_COMMANDS,
    group: GROUP_COMMANDS,
    light: LIGHT_COMMANDS,
    view: VIEW_COMMANDS,
    hide: HIDE_COMMANDS,
    camera: CAMERA_COMMANDS,
    onion: ONION_COMMANDS,
    measure: MEASURE_COMMANDS,
    placement: PLACEMENT_COMMANDS,
    proposal: PROPOSAL_COMMANDS,
  };
}

const registry: LabCommandRegistry = createCommandRegistry<CommandState, CommandHost, EditOp>();
/** The plugin whose commands are in the registry. */
let registeredFor: EditorPlugin | null = null;

/** The registry with the commands of the registered plugin. A new plugin registers its commands again. */
export function commandRegistry(): LabCommandRegistry {
  const plugin = editorPlugin();
  if (registeredFor !== plugin) {
    registry.clear();
    registeredFor = plugin;
    plugin.registerCommands(registry, coreCommands());
  }
  return registry;
}

/** The commands of the editor, in the order of the palette. */
export function commandList(): readonly Command[] {
  return commandRegistry().list();
}

/** The command of an ID, or undefined. */
export function commandNamed(id: string): Command | undefined {
  return commandRegistry().named(id);
}

/** Why a command cannot run in a state with these arguments (the selection rule, then the condition), or null. */
export function commandBlock(command: Command, state: CommandState, args: Args = {}): string | null {
  return commandRegistry().block(command, state, args);
}

/** The commands as the palette and the tools list them, with the commands that can run in the current state. */
export function commandListings(state: CommandState): CommandListing[] {
  return commandRegistry().listings(state);
}

/**
 * Prepare a command: find it, check its arguments and its selection rule, and build its result. A problem throws a
 * CommandError with the words for the owner and Claude.
 */
export function prepareCommand(id: string, raw: unknown, state: CommandState): CommandOutcome {
  return commandRegistry().prepare(id, raw, state);
}
