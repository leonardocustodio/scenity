// SPDX-License-Identifier: Apache-2.0
/**
 * The command runner of the lab page. It runs the commands of the registry (commands.ts) for the keys, the buttons,
 * the palette (CommandPalette.vue), the script API and the tools of the workbench host (`scene_commands`,
 * `scene_command`).
 *
 * - **An edit command** gives edit operations. The runner applies them through the editor (useEditor.ts) as one step of
 *   the history. Or it keeps them as a **proposal**: a list of operations that is not applied, with its ID and its
 *   author. `accept` applies a proposal, and `reject` removes it. The keys, buttons and palette of the owner apply
 *   immediately. A script or Claude makes a proposal by default. Only the switch of the session
 *   (`setProposalMode("apply")`, the choice of the owner) lets Claude apply immediately. A script also applies with
 *   `mode: "apply"`. The scene shows the proposals as ghosts from the same edits.
 * - **A view command** runs immediately in both modes. It is not an input of the scene (the selection, the camera, the
 *   marks, the ask), or it moves in the history (undo, redo).
 * - **Source ops** (ops.ts) wait as pending runs of the editor. "Save placement" goes to the host through the
 *   `placement` bridge event, then `labs tune-apply`. Then the runner settles its run. A source op with a route
 *   (`sources`) goes the same way. For example, "Save camera" uses the `camera` bridge event, then `labs camera-save`.
 *   Other source ops wait.
 *
 * The switch of the session is a view setting of the lab, not an input. It is in `sessionStorage`, never in the URL.
 *
 * The runner itself is `createRunner` of `@scenity/editor-core`: the proposals, the switch and the rule that tells
 * which author applies immediately. This module gives it the registry, the editor and the routes of the lab page. It
 * keeps the state of the runner in Vue refs.
 */
import {
  createRunner,
  isProposalMode,
  readProposalMode,
  type ApplyReport,
  type CommandOptions,
  type CommandRun as CoreCommandRun,
  type ProposalMode,
  type Proposal as CoreProposal,
} from "@scenity/editor-core";
import { tunables, type SelectTarget } from "@scenity/runtime-dev";
import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import {
  CommandError,
  commandRegistry,
  PLACEMENT_TOOL,
  type Args,
  type CommandHost,
  type CommandListing,
  type CommandState,
} from "./commands";
import { editProblems, type Edit, type EditOp, type PendingRun } from "./ops";
import type { Editor } from "./useEditor";

// The plugin has the view host, the key relay and the runner of the lab page.

export type { CommandBy, CommandOptions, ProposalMode } from "@scenity/editor-core";

/** An edit that waits for the owner. */
export type Proposal = CoreProposal<EditOp>;

/** The result of a command for the palette, the script API and the tools: the run and the tune values after it. */
export type CommandRun = CoreCommandRun<EditOp> & {
  /** The tune values after the command. */
  readonly tunes: Readonly<Record<string, number>>;
};

/** The functions of the page that the view commands use, without the proposals (the runner gives them). */
export type ViewHost = Omit<CommandHost, "accept" | "reject" | "acceptAll" | "rejectAll">;

/** The path of "Save placement": the bridge event `placement` in the workbench. */
export interface PlacementRoute {
  inWorkbench(): boolean;
  save(dry: boolean): void;
}

/**
 * The host path of the source ops of a tool other than "Save placement" (for example `labs camera-save`). In the
 * workbench, the run goes to the host. Else it waits as a pending run, and the lab page shows its command.
 */
export interface SourceRoute {
  readonly tool: string;
  inWorkbench(): boolean;
  send(run: PendingRun): void;
}

/**
 * The view state that the selection rules and the conditions read: the selection and the marks, the camera and the
 * groups, and the parts of a plugin (`P`, for example the current team and the hand targets).
 */
export type CommandView<P extends object = object> = {
  readonly selection: SelectTarget | null;
  readonly marking: boolean;
  readonly marks: number;
} & Pick<CommandState, "camera" | "selected" | "groups"> &
  P;

export interface CommandParts<P extends object = object, H extends ViewHost = ViewHost> {
  readonly editor: Editor;
  readonly tunes: Ref<Record<string, number>>;
  /** The view state that the selection rules and the conditions read (reactive reads). */
  readonly view: () => CommandView<P>;
  /** The functions of the page and the tools of a plugin (`H` adds the hosts of the plugin). */
  readonly host: H;
  readonly placement: PlacementRoute;
  /** The host paths of other source ops. */
  readonly sources?: readonly SourceRoute[];
  /** Add the methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

export interface CommandRunner {
  /** The commands with their current run state (the palette hides the commands that cannot run). */
  readonly listings: ComputedRef<CommandListing[]>;
  readonly proposals: ShallowRef<readonly Proposal[]>;
  readonly mode: Ref<ProposalMode>;
  /** The palette is open (⌘P, the bridge call `openPalette`). */
  readonly paletteOpen: Ref<boolean>;
  setPalette(open: boolean): void;
  /** The words of the last failure of a key or a button, or null. */
  readonly status: Ref<string | null>;
  run(id: string, args?: unknown, options?: CommandOptions): Promise<CommandRun>;
  /** A key or a button of the owner: apply immediately (`propose` stages it). A failure only sets the status. */
  key(id: string, args?: Args, mode?: ProposalMode): void;
  /** A run of the palette: null when the command ran, else the words of the failure. */
  palette(id: string, args: Args): Promise<string | null>;
  accept(id: string): CommandRun;
  reject(id: string): boolean;
  acceptAll(): CommandRun[];
  rejectAll(): number;
  setMode(mode: ProposalMode): ProposalMode;
}

/** The commands of the script API (`globalThis.__room3dLab`), for the tools of the host. */
export interface LabCommandApi {
  /** The commands of the registry, with their current run state. */
  commands(): CommandListing[];
  /** Run a command. An edit of a script or Claude is a proposal, except when `mode` or the switch is "apply". */
  command(id: string, args?: unknown, options?: CommandOptions): Promise<CommandRun>;
  /** The proposals that wait, in their sequence. */
  proposals(): Proposal[];
  accept(id: string): CommandRun;
  reject(id: string): boolean;
  acceptAll(): CommandRun[];
  /** The switch of the session: "apply" lets the edits of Claude apply immediately. Returns the current switch. */
  setProposalMode(mode: ProposalMode): ProposalMode;
  proposalMode(): ProposalMode;
  /** Open the palette (the workbench page sends ⌘P with this call when the focus is outside the lab frame). */
  openPalette(): boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for the source run of "Save placement" (commands.ts `placement.save`). */
function isPlacement(run: PendingRun): boolean {
  return run.tool === PLACEMENT_TOOL && run.args.placement === true;
}

/** The state that the commands read: the view state of the page and of its plugin, the tune values and the history. */
function stateOf(parts: CommandParts, defaults: ReadonlyMap<string, number>, proposals: number) {
  return {
    ...parts.view(),
    tunes: parts.tunes.value,
    defaults,
    canUndo: parts.editor.history.canUndo.value,
    canRedo: parts.editor.history.canRedo.value,
    proposals,
  } satisfies CommandState;
}

/** Apply an edit as one step of the history. Send "Save placement" and the other routed source ops to the host. */
function applyEdit(parts: CommandParts, edit: Edit): ApplyReport {
  const { editor, placement } = parts;
  const done = editor.apply(edit);
  const sent: PendingRun[] = [];
  for (const run of done.pending) {
    // A source op of another tool goes to the host through its own path.
    const route = parts.sources?.find((item) => item.tool === run.tool);
    if (route?.inWorkbench() === true) route.send(run);
    else if (!isPlacement(run) || !placement.inWorkbench()) continue;
    else placement.save(run.args.dry !== false);
    editor.settle(run);
    sent.push(run);
  }
  return { step: done.applied, pending: done.pending.filter((run) => !sent.includes(run)), sent };
}

/** The commands of the script API on a runner. */
function commandApi(runner: CommandRunner): LabCommandApi {
  return {
    commands: () => runner.listings.value,
    command: (id, args, options) => runner.run(id, args, options),
    proposals: () => [...runner.proposals.value],
    accept: (id) => runner.accept(id),
    reject: (id) => runner.reject(id),
    acceptAll: () => runner.acceptAll(),
    setProposalMode: (mode) => runner.setMode(mode),
    proposalMode: () => runner.mode.value,
    openPalette: () => {
      runner.setPalette(true);
      return true;
    },
  };
}

export function useCommands<P extends object, H extends ViewHost>(parts: CommandParts<P, H>): CommandRunner {
  const defaults = new Map(tunables().map((item) => [item.path, item.default]));
  const proposals = shallowRef<readonly Proposal[]>([]);
  const mode = ref<ProposalMode>(readProposalMode());
  const base = parts as unknown as CommandParts;
  const core = createRunner<CommandState, CommandHost, EditOp, { readonly tunes: Readonly<Record<string, number>> }>({
    registry: commandRegistry(),
    state: (count) => stateOf(base, defaults, count),
    host: parts.host,
    apply: (edit) => applyEdit(base, edit),
    problems: (edit) => editProblems(edit, (path) => defaults.has(path)),
    proposals,
    mode,
    // Each result holds the tune values after the command.
    extra: () => ({ tunes: { ...parts.tunes.value } }),
  });
  const status = ref<string | null>(null);
  const paletteOpen = ref(false);
  const run: CommandRunner["run"] = (id, args = {}, options = {}) => core.run(id, args, options);
  const runner: CommandRunner = {
    listings: computed(() => core.listings()),
    proposals,
    mode,
    paletteOpen,
    setPalette: (open) => {
      paletteOpen.value = open;
    },
    status,
    run,
    key(id, args = {}, keyMode) {
      run(id, args, keyMode === undefined ? { by: "owner" } : { by: "owner", mode: keyMode }).then(
        () => {
          status.value = null;
        },
        (error: unknown) => {
          status.value = errorText(error);
        },
      );
    },
    async palette(id, args) {
      try {
        await run(id, args, { by: "owner" });
        status.value = null;
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    accept: (id) => core.accept(id),
    reject: (id) => core.reject(id),
    acceptAll: () => core.acceptAll(),
    rejectAll: () => core.rejectAll(),
    setMode: (next) => {
      if (!isProposalMode(next)) throw new CommandError(`The mode is "propose" or "apply", not "${String(next)}".`);
      return core.setMode(next);
    },
  };
  if (parts.api !== false) installApi(commandApi(runner));
  return runner;
}
