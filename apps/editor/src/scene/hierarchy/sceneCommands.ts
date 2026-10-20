// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the scene page in the edit mode: a registry of the hierarchy
 * commands of `@scenity/editor-core` and a runner over the scene channel of the page editor. Each edit is one step
 * of the one history (the scene document and the view state). The panel, the keys and the script API run the same
 * commands. This module has no Vue, so the page makes it before the lazy panel chunk loads.
 *
 * The registry also has the entity commands (add, duplicate, delete, copy, paste) with the clipboard of the
 * page (pageClipboard.ts: one copy for each project). After an add, a duplicate or a paste the page selects the new
 * roots; after each change of the document the selection keeps only the entities that exist.
 *
 * The registry also has the transform commands (`entity.move`, `entity.turn`, `entity.scale`). A run of
 * Claude (the tool `scene_command` through the bridge, `{ by: "claude" }`) is a proposal by default: the proposal card
 * (proposalCard.ts) shows it, and the owner accepts or rejects it. Only the switch of the session (the session storage
 * of `@scenity/editor-core`, `setProposalMode("apply")`) lets the edits of Claude apply immediately.
 *
 * The registry also has the prefab commands (`prefab.apply`, `prefab.revert`); their edits change the scene
 * and the prefab set of the page in one step. The selection keeps the prefab entities of the expanded document.
 *
 * The registry also has the material command (`material.assign`): one scene op of an override of a part.
 */
import { pageListing } from "./listingTexts";
import {
  addedRoots,
  changeSetsOf,
  CommandError,
  createCommandRegistry,
  createRunner,
  EditError,
  editProblems,
  COMPONENT_COMMANDS,
  ENTITY_COMMANDS,
  actorOf,
  PERSON,
  PRESET_COMMANDS,
  TAG_COMMANDS,
  entityTarget,
  readProposalMode,
  TRANSFORM_COMMANDS,
  HIERARCHY_COMMANDS,
  MATERIAL_COMMANDS,
  PREFAB_COMMANDS,
  PREFAB_UNPACK_COMMANDS,
  prefabOpKind,
  sceneOpEntity,
  sceneOpKind,
  VIEW_OP,
  type Actor,
  type ChangeSet,
  type Cell,
  type Command,
  type CommandListing,
  type CommandOptions,
  type CommandRun,
  type EntityHost,
  type OpContext,
  type PrefabPageOp,
  type PrefabState,
  type Proposal,
  type ProposalMode,
  type Runner,
  type SceneView,
} from "@scenity/editor-core";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { TurnUndoAnswer } from "@scenity/bridge";
import { revertTurn } from "../review/turnUndo";
import { keepCheckpoint, restoreCheckpoint } from "../review/checkpoints";
import { pageClipboard, type PageClipboard } from "../pageClipboard";
import { runBatch, type BatchStep } from "./commandBatch";
import { presetArgs } from "./presetInput";
import { insideRun, routedEdit } from "./prefabRouting";
import { pageActivity, replayLines, type ActivityEntry } from "../activity/activityLog";
import { pageKeys, type WindowCommand } from "../settings/pageKeys";
import type { ScenePageEditor } from "../sceneEditor";

/** The ops of the page commands: scene ops, view ops and prefab ops. */
export type PageOp = PrefabPageOp;

/** The parts of the selection of the page that the commands use (`PageSelection` of selection.ts). */
export interface SelectionPort {
  readonly ids: readonly string[];
  set(ids: readonly string[]): void;
  listen(listener: (ids: readonly string[]) => void): () => void;
}

/** The last action of the person: its command, its arguments, its title and its step of the history. */
export interface LastAction {
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly title: string;
  /** The index of its step in the history: an adjust runs only while it is the step now. */
  readonly index: number;
  /** The line of the activity log. */
  readonly line: number;
}

/** The commands of the page. */
export interface SceneCommands {
  /**
   * Run a command. A run of the owner (the default) applies immediately, and a run of Claude follows the proposal rule.
   * A refusal throws a CommandError with the reason.
   */
  run(id: string, args?: Readonly<Record<string, unknown>>, options?: CommandOptions): Promise<CommandRun<PageOp>>;
  listings(): CommandListing[];
  /** The last action of the person that made a step, or null. */
  lastAction(): LastAction | null;
  /** Run the last action again with changed arguments, as the same step (an undo, then a run). */
  adjust(change: Readonly<Record<string, unknown>>): Promise<CommandRun<PageOp>>;
  listenLast(listener: () => void): () => void;
  /** Run the steps of a batch as one step of the history (or one proposal); a failed step changes nothing. */
  batch(steps: readonly BatchStep[], title: string, options?: CommandOptions): Promise<CommandRun<PageOp>>;
  /** The command definitions with their default keys (the key map of the page reads them). */
  definitions(): readonly Command<PrefabState, EntityHost, PageOp>[];
  /** Add commands of the page (the presets of the person); the result removes them. */
  extend(commands: readonly Command<PrefabState, EntityHost, PageOp>[]): () => void;
  /** The proposals that wait, the accept and the reject of the owner, and the switch of the session. */
  proposals(): readonly Proposal<PageOp>[];
  accept(id: string): CommandRun<PageOp>;
  reject(id: string): boolean;
  mode(): ProposalMode;
  setMode(mode: ProposalMode): ProposalMode;
  /** Call the listener after each change of the proposals. The result stops the listener. */
  listenProposals(listener: (proposals: readonly Proposal<PageOp>[]) => void): () => void;
  /** The change sets of the proposals (the proposals of one turn of an agent session form one set). */
  changeSets(): ChangeSet<PageOp>[];
  /** Apply the chosen ops (`<proposal>:<index>`) as one step with the title; the other ops continue to wait. */
  acceptOps(keys: readonly string[], title: string): CommandRun<PageOp>;
  /** Drop the chosen ops; the count of the dropped ops. */
  rejectOps(keys: readonly string[]): number;
  /** Revert the steps of a turn of an agent session as one step and drop its proposals that wait. */
  undoTurn(session: string, turn: number): TurnUndoAnswer;
}

/** The commands part of the script API of the scene page. */
export interface SceneCommandApi {
  /**
   * Run a command of the page. Without options, the script applies immediately (an owner run). The bridge
   * gives `{ by: "claude" }` for the tool `scene_command`. Each command of the editor window runs here (a scene
   * command gives its `CommandRun`).
   */
  command(id: string, args?: Readonly<Record<string, unknown>>, options?: CommandOptions): Promise<unknown>;
  /** Each command of the editor window with its metadata and what can run now. */
  commands(): WindowCommand[];
  /** The last action of the person, and its run again with changed arguments as the same step. */
  lastAction(): LastAction | null;
  adjustLast(change: Readonly<Record<string, unknown>>): Promise<CommandRun<PageOp>>;
  /** The lines of the activity log, the oldest first. */
  activity(): readonly ActivityEntry[];
  /** Run the lines of a log that applied, in their order (a replay into a copy of the scene). */
  replayActivity(entries: readonly ActivityEntry[]): Promise<void>;
  /** Run the steps of a batch of scene commands as one named step of the history (all or none). */
  commandBatch(steps: readonly BatchStep[], title?: string, options?: CommandOptions): Promise<CommandRun<PageOp>>;
  /** The view state of the hierarchy panel (solo and lock). */
  view(): SceneView;
  /** The steps of the history (the oldest first) with their titles and actors, and the step now. */
  history(): { readonly index: number; readonly steps: readonly { readonly title: string; readonly actor: Actor }[] };
  /** The proposals that wait (an ID, the command, the edit and who made it). */
  proposals(): readonly Proposal<PageOp>[];
  /** The owner accepts a proposal (one step of the history) or rejects it. */
  accept(id: string): CommandRun<PageOp>;
  reject(id: string): boolean;
  /** The change sets, and the accept or the reject of some of their ops (`<proposal>:<index>`). */
  changeSets(): ChangeSet<PageOp>[];
  acceptOps(keys: readonly string[], title: string): CommandRun<PageOp>;
  rejectOps(keys: readonly string[]): number;
  /** "Undo the turn": revert the steps of a turn of an agent session as one step. */
  undoTurn(session: string, turn: number): TurnUndoAnswer;
  /** Keep the scene for the start of a turn, and restore the scene of that checkpoint as one step. */
  checkpoint(session: string, turn: number): boolean;
  restoreCheckpoint(session: string, turn: number): TurnUndoAnswer;
  /** The switch of the session ("propose" or "apply"), and its change by the owner. */
  proposalMode(): ProposalMode;
  setProposalMode(mode: ProposalMode): ProposalMode;
}

const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

/** Select the new roots of an applied edit (an add, a duplicate or a paste). */
function selectAdded(run: CommandRun<PageOp>, selection: SelectionPort): void {
  if (run.outcome !== "applied") return;
  const roots = addedRoots(run.ops.flatMap((op) => (op.kind === "scene" ? [op.op] : [])));
  if (roots.length > 0) selection.set(roots);
}

/** After each change of the document, the selection keeps only the entities that exist. */
function keepSelection(editor: ScenePageEditor, selection: SelectionPort): void {
  editor.listen((doc) => {
    // A prefab entity (`<instance>/<entity>`) is an entity of the expanded document.
    const shown = editor.expanded;
    const kept = selection.ids.filter((id) => Object.hasOwn(doc.entities, id) || Object.hasOwn(shown.entities, id));
    if (kept.length !== selection.ids.length) selection.set(kept);
  });
}

/** A cell that calls a listener after each write (the proposal card follows the proposals). */
function watchedCell<T>(start: T, changed: (value: T) => void): Cell<T> {
  let value = start;
  return {
    get value() {
      return value;
    },
    set value(next: T) {
      value = next;
      changed(next);
    },
  };
}

/** The cells of a runner of the page: the proposals and the switch of the session. */
interface RunnerCells {
  readonly proposals: Cell<readonly Proposal<PageOp>[]>;
  readonly mode: Cell<ProposalMode>;
  /**
   * `value` is true while a run names an entity of a prefab instance: the commands see the expanded document.
   * `base` is true while a prefab command runs: it sees the document (it reads the instances, not their entities).
   */
  readonly inside: { value: boolean; base: boolean };
}

/** The runner of the page over the registry, the editor, the selection and the clipboard. */
function pageRunner(
  editor: ScenePageEditor,
  selection: SelectionPort,
  clipboard: PageClipboard,
  cells: RunnerCells,
  registry = createCommandRegistry<PrefabState, EntityHost, PageOp>(),
): Runner<PageOp> {
  registry.register(HIERARCHY_COMMANDS);
  registry.register(ENTITY_COMMANDS);
  registry.register(TRANSFORM_COMMANDS);
  registry.register(PREFAB_COMMANDS);
  // Unpack an instance.
  registry.register(PREFAB_UNPACK_COMMANDS);
  // The assignment of a material asset to a part of an entity.
  registry.register(MATERIAL_COMMANDS);
  // The inspector edits (set, reset, add and remove a component) for a script and an agent.
  registry.register(COMPONENT_COMMANDS);
  // The create presets (`entity.create.<preset>`).
  registry.register(PRESET_COMMANDS);
  // The rename of a tag and of a pick layer across the scene.
  registry.register(TAG_COMMANDS);
  const kinds = [sceneOpKind(editor.registry), VIEW_OP, prefabOpKind(editor.registry)];
  const prefabPaths = editor.expander?.paths ?? { docPath: editor.file.path };
  return createRunner<PrefabState, EntityHost, PageOp>({
    registry,
    state: () => {
      const items = selection.ids.map((id) => entityTarget(id));
      // With an entity of a prefab instance in the selection, the commands see the expanded document; their
      // ops on prefab entities become overrides of the instance (apply).
      const inside = !cells.inside.base && (cells.inside.value || selection.ids.some((id) => id.includes("/")));
      const doc = inside ? editor.expanded : editor.doc;
      const base = { doc, view: editor.view, selection: items[0] ?? null, selected: items };
      const prefabs = { prefabs: editor.prefabs, prefabPaths };
      return { ...base, clipboard: clipboard.read(), registry: editor.registry, ...prefabs };
    },
    host: {
      select: (target) => {
        selection.set(target === null ? [] : [target.id]);
      },
      selectAll: (targets) => {
        selection.set(targets.map((target) => target.id));
      },
      undo: () => editor.channel.undo(),
      redo: () => editor.channel.redo(),
      copy: (data) => {
        clipboard.write(data);
      },
    },
    apply: (edit) => {
      try {
        const result = editor.channel.apply(routedEdit(editor.doc, edit));
        return { step: result.applied, pending: result.pending, sent: [] };
      } catch (error) {
        if (error instanceof EditError) throw new CommandError(error.message);
        throw error;
      }
    },
    problems: (edit) => editProblems(edit, kinds, NO_TUNES),
    proposals: cells.proposals,
    mode: cells.mode,
  });
}

/** The last action of the person and its listeners. */
function lastActions() {
  const listeners = new Set<() => void>();
  return {
    value: null as LastAction | null,
    set(next: LastAction): void {
      this.value = next;
      for (const listener of listeners) listener();
    },
    listen(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The run of a command: the selection of the added entities, the line of the activity log and the last action. */
function trackedRun(
  runner: Runner<PageOp>,
  editor: ScenePageEditor,
  selection: SelectionPort,
  lasts: ReturnType<typeof lastActions>,
): SceneCommands["run"] {
  return async (id, given = {}, options = {}) => {
    // A preset with an input asks the person for it.
    const args = await presetArgs(id, given, options);
    const done = await runner.run(id, args, { by: "owner", ...options });
    selectAdded(done, selection);
    // Each run is a line of the activity log.
    const by = options.by ?? "owner";
    const actor = actorOf(by, options.actor);
    const line = pageActivity().record({
      command: id,
      args: { ...args },
      title: done.title,
      outcome: done.outcome,
      actor,
    });
    if (by === "owner" && done.step) {
      const index = editor.channel.history.steps().index;
      lasts.set({ command: id, args: { ...args }, title: done.title, index, line });
    }
    return done;
  };
}

/**
 * Make the commands of the page over its editor and its selection. `clipboard` is the clipboard of the
 * project (default: a clipboard in the memory of the page). The switch of the session starts from the session
 * storage.
 */
export function sceneCommands(
  editor: ScenePageEditor,
  selection: SelectionPort,
  clipboard: PageClipboard = pageClipboard(null),
): SceneCommands {
  const listeners = new Set<(proposals: readonly Proposal<PageOp>[]) => void>();
  const proposals = watchedCell<readonly Proposal<PageOp>[]>([], (value) => {
    for (const listener of listeners) listener(value);
  });
  const mode: Cell<ProposalMode> = { value: readProposalMode() };
  const registry = createCommandRegistry<PrefabState, EntityHost, PageOp>();
  const inside = { value: false, base: false };
  const runner = pageRunner(editor, selection, clipboard, { proposals, mode, inside }, registry);
  keepSelection(editor, selection);
  // The last action of the person that made a step, which the Adjust panel can run again.
  const lasts = lastActions();
  const run = insideRun(trackedRun(runner, editor, selection, lasts), editor, inside);
  return {
    run,
    lastAction: () => lasts.value,
    adjust: async (change) => {
      const now = lasts.value;
      if (now === null) throw new CommandError("No action to adjust.");
      if (editor.channel.history.steps().index !== now.index) {
        throw new CommandError(`Another step came after "${now.title}": it cannot change now.`);
      }
      editor.channel.undo();
      pageActivity().mark(now.line, "adjusted");
      return run(now.command, { ...now.args, ...change });
    },
    listenLast: (listener) => lasts.listen(listener),
    listings: () => runner.listings().map(pageListing),
    batch: async (steps, title, options = {}) => {
      const parts = { runner, history: editor.channel.history, mode: () => mode.value };
      const run = await runBatch(parts, steps, title, { by: "owner", ...options });
      selectAdded(run, selection);
      const actor = actorOf(options.by ?? "owner", options.actor);
      pageActivity().record({ command: "batch", args: { steps }, title, outcome: run.outcome, actor });
      return run;
    },
    definitions: () => registry.list(),
    extend: (list) => {
      registry.register(list);
      return () => registry.unregister(list.map((command) => command.id));
    },
    proposals: () => proposals.value,
    accept: (id) => {
      const proposal = proposals.value.find((item) => item.id === id);
      const run = runner.accept(id);
      selectAdded(run, selection);
      // The line of an accepted proposal names the actor of the proposal.
      if (proposal !== undefined) {
        const actor = proposal.edit.actor ?? actorOf(proposal.by);
        const { command, args } = proposal;
        pageActivity().record({ command, args: { ...args }, title: run.title, outcome: run.outcome, actor });
      }
      return run;
    },
    reject: (id) => runner.reject(id),
    ...reviewCommands(runner, proposals, editor, selection),
    mode: () => mode.value,
    setMode: (next) => runner.setMode(next),
    listenProposals: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The change sets, the accept and the reject of some of their ops, and "Undo the turn". */
function reviewCommands(
  runner: Runner<PageOp>,
  proposals: Cell<readonly Proposal<PageOp>[]>,
  editor: ScenePageEditor,
  selection: SelectionPort,
): Pick<SceneCommands, "changeSets" | "acceptOps" | "rejectOps" | "undoTurn"> {
  return {
    changeSets: () => changeSetsOf(proposals.value, pageOpEntity),
    acceptOps: (keys, title) => {
      const chosen = new Set(keys);
      const ops = changeSetsOf(proposals.value, pageOpEntity)
        .flatMap((set) => set.ops)
        .filter((item) => chosen.has(item.key));
      const actor = proposals.value.find((item) => item.id === ops[0]?.proposal)?.edit.actor ?? PERSON;
      const run = runner.acceptOps(keys, title);
      selectAdded(run, selection);
      // The line of the review keeps the scene ops, so a replay applies them again.
      const sceneOps = ops.flatMap((item) => (item.op.kind === "scene" ? [item.op.op] : []));
      pageActivity().record({ command: REVIEW_ACCEPT, args: { ops: sceneOps }, title, outcome: run.outcome, actor });
      return run;
    },
    rejectOps: (keys) => runner.rejectOps(keys),
    undoTurn: (session, turn) => {
      const set = `${session}#${String(turn)}`;
      const keys = changeSetsOf(proposals.value, pageOpEntity)
        .filter((item) => item.key === set)
        .flatMap((item) => item.ops.map((op) => op.key));
      const dropped = keys.length === 0 ? 0 : runner.rejectOps(keys);
      return { ...revertTurn(editor, session, turn), dropped };
    },
  };
}

/** The command of an activity line of an accepted part of a change set. */
const REVIEW_ACCEPT = "review.accept";

/** The entity of an op of the page, or null. */
export function pageOpEntity(op: PageOp): string | null {
  return op.kind === "scene" ? sceneOpEntity(op.op) : null;
}

/** Apply the scene ops of an activity line of a review again as one step. */
function applyReview(editor: ScenePageEditor, line: ActivityEntry): void {
  const reason = editor.apply(line.args.ops as SceneOp[]);
  if (reason !== null) throw new CommandError(reason);
}

/** The script API of the commands. */
export function commandApi(commands: SceneCommands, editor: ScenePageEditor): SceneCommandApi {
  return {
    command: (id, args, options) => pageKeys().execute(id, args, options),
    commands: () => pageKeys().list(),
    lastAction: () => commands.lastAction(),
    adjustLast: (change) => commands.adjust(change),
    activity: () => pageActivity().entries.value,
    replayActivity: async (entries) => {
      const how = { by: "script", mode: "apply" } as const;
      for (const line of replayLines(entries)) {
        if (line.command === "batch") await commands.batch(line.args.steps as readonly BatchStep[], line.title, how);
        else if (line.command === REVIEW_ACCEPT) applyReview(editor, line);
        else await commands.run(line.command, line.args, how);
      }
    },
    commandBatch: (steps, title, options) =>
      commands.batch(steps, title ?? `${String(steps.length)} commands`, options),
    view: () => editor.view,
    history: () => {
      const { index, steps } = editor.channel.history.steps();
      const labelled = steps.map((step) => ({ title: step.label?.title ?? "", actor: step.label?.actor ?? PERSON }));
      return { index, steps: labelled };
    },
    proposals: () => commands.proposals(),
    accept: (id) => commands.accept(id),
    reject: (id) => commands.reject(id),
    changeSets: () => commands.changeSets(),
    acceptOps: (keys, title) => commands.acceptOps(keys, title),
    rejectOps: (keys) => commands.rejectOps(keys),
    undoTurn: (session, turn) => commands.undoTurn(session, turn),
    checkpoint: (session, turn) => keepCheckpoint(editor, session, turn),
    restoreCheckpoint: (session, turn) => ({ ...restoreCheckpoint(editor, session, turn), dropped: 0 }),
    proposalMode: () => commands.mode(),
    setProposalMode: (mode) => commands.setMode(mode),
  };
}
