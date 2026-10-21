// SPDX-License-Identifier: Apache-2.0
/**
 * The command runner. It runs the commands of a registry for the owner (keys, buttons, the palette), for Claude (the
 * tool `scene_command`) and for a script.
 *
 * - **An edit command** gives edit ops. The runner applies them as one step of the history, or keeps them as a
 *   **proposal**: an edit that is not applied yet, with its ID and who made it. `accept` applies a proposal, and
 *   `reject` removes it. The owner applies immediately. A script or Claude makes a proposal by default. Only the switch
 *   of the session (`setMode("apply")`, the owner's choice) lets Claude apply immediately. A script also applies with
 *   `mode: "apply"`.
 * - **A view command** runs immediately in both modes. It is not an input of the scene (the selection, the camera), or
 *   it moves in the history (undo, redo).
 *
 * The switch of the session is a view setting, not an input: it is in the session storage, never in the URL. The
 * runner keeps its proposals and its switch in cells (`{ value }`). Thus an editor can give reactive cells. No Vue
 * import.
 */
import { CommandError, type CommandHost, type CommandKind, type CommandListing } from "./command";
import { PERSON, type Actor, type BaseOp, type Edit, type PendingRun } from "./ops";
import type { CommandRegistry, RuleState } from "./registry";

/** Propose: Claude's edits wait for the owner. Apply: they apply immediately. */
export type ProposalMode = "propose" | "apply";

/** Who runs a command: the owner (keys, buttons, palette), Claude (`scene_command`) or a script. */
export type CommandBy = "owner" | "claude" | "script";

export interface CommandOptions {
  readonly mode?: ProposalMode;
  readonly by?: CommandBy;
  /** Who runs the command (an agent session with its name and colour). Absent: the actor of `by`. */
  readonly actor?: Actor;
}

/** The actor of a run: the given actor, else the kind of `by` (the owner is the person, Claude is an agent). */
export function actorOf(by: CommandBy, actor?: Actor): Actor {
  if (actor !== undefined) return actor;
  return by === "owner" ? PERSON : by === "claude" ? { kind: "agent", name: "Claude" } : { kind: "script" };
}

/** An edit that waits for the owner. */
export interface Proposal<O extends BaseOp = BaseOp> {
  readonly id: string;
  readonly edit: Edit<O>;
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly by: CommandBy;
}

/** What a command did, for the palette, the script API and the tool result. */
export interface CommandRun<O extends BaseOp = BaseOp> {
  readonly command: string;
  readonly kind: CommandKind;
  readonly title: string;
  /**
   * "proposed": a proposal waits. "applied": the ops changed an input or gave a source run. "unchanged": the ops
   * changed no input. "ran": a view command ran.
   */
  readonly outcome: "proposed" | "applied" | "unchanged" | "ran";
  /** The ID of the proposal, or null. */
  readonly proposal: string | null;
  /** The ID of the edit, or null for a view command. */
  readonly edit: string | null;
  /** True when the edit made one step of the undo history. */
  readonly step: boolean;
  readonly ops: readonly O[];
  /** The source ops that wait for a run of their tool. */
  readonly pending: readonly PendingRun[];
  /** The source ops that went to the host. */
  readonly sent: readonly PendingRun[];
  /** The value of a view command, or null. */
  readonly value: unknown;
  /** The current switch of the session. */
  readonly mode: ProposalMode;
}

/** What an apply of an edit did: a step of the history, the source runs that wait and the runs that went to the host. */
export interface ApplyReport {
  readonly step: boolean;
  readonly pending: readonly PendingRun[];
  readonly sent: readonly PendingRun[];
}

/** A value that the runner reads and writes (a Vue ref fits). */
export interface Cell<T> {
  value: T;
}

type ProposalKeys = "accept" | "reject" | "acceptAll" | "rejectAll" | "acceptOps" | "rejectOps";

export interface RunnerParts<S extends RuleState, H extends CommandHost, O extends BaseOp, X extends object = object> {
  readonly registry: CommandRegistry<S, H, O>;
  /** The state that the commands read, with the number of the proposals that wait. */
  state(proposals: number): S;
  /** The functions of the page that the view commands use, without the proposal functions (the runner gives them). */
  readonly host: Omit<H, ProposalKeys>;
  /** Apply an edit as one step of the history. A problem throws and changes nothing. */
  apply(edit: Edit<O>): ApplyReport;
  /** The problems of an edit, before it waits as a proposal. */
  problems(edit: Edit<O>): readonly string[];
  readonly proposals: Cell<readonly Proposal<O>[]>;
  readonly mode: Cell<ProposalMode>;
  /** Keep the switch of the session (default: the session storage). */
  keepMode?(mode: ProposalMode): void;
  /** More fields of each result, read when the result is made (for example the tune values after the command). */
  extra?(): X;
}

export interface Runner<O extends BaseOp, X extends object = object> {
  run(id: string, args?: unknown, options?: CommandOptions): Promise<CommandRun<O> & X>;
  accept(id: string): CommandRun<O> & X;
  reject(id: string): boolean;
  acceptAll(): (CommandRun<O> & X)[];
  rejectAll(): number;
  /**
   * Apply the chosen ops of the proposals (keys `<proposal>:<index>`, changeSets.ts) as one step of the history with
   * the title. Each proposal keeps its other ops, and a proposal with no remaining op goes. A problem throws and
   * changes nothing.
   */
  acceptOps(keys: readonly string[], title: string): CommandRun<O> & X;
  /** Remove the chosen ops of the proposals. The result is the count of the removed ops. */
  rejectOps(keys: readonly string[]): number;
  /** The commands, with what can run in the current state. */
  listings(): CommandListing[];
  setMode(mode: ProposalMode): ProposalMode;
  /**
   * Keep an edit of many commands (a batch) as one proposal of `command`. The runner gives the edit its ID. A refusal
   * (the edit is not valid in the current state) throws a CommandError.
   */
  propose(edit: Omit<Edit<O>, "id">, command: string, args: unknown, by: CommandBy): CommandRun<O> & X;
}

/** The key of the switch in the storage of the session. */
export const PROPOSAL_MODE_KEY = "scenity.labs.proposalMode";

/** The switch of the session from the session storage ("propose" without storage). */
export function readProposalMode(): ProposalMode {
  try {
    return globalThis.sessionStorage.getItem(PROPOSAL_MODE_KEY) === "apply" ? "apply" : "propose";
  } catch {
    return "propose";
  }
}

/** Keep the switch of the session in the session storage. */
export function keepProposalMode(mode: ProposalMode): void {
  try {
    globalThis.sessionStorage.setItem(PROPOSAL_MODE_KEY, mode);
  } catch {
    // A page without storage keeps the switch until it closes.
  }
}

export function isProposalMode(value: unknown): value is ProposalMode {
  return value === "propose" || value === "apply";
}

/**
 * True when an edit applies immediately, else it is a proposal. The owner applies immediately, but a command that
 * proposes waits unless the mode is "apply". Only the switch of the session lets Claude apply immediately. Its mode
 * "apply" alone stays a proposal. Its mode "propose" makes a proposal also when the switch is "apply". A script applies
 * with the mode "apply" or the switch.
 */
export function appliesAtOnce(
  by: CommandBy,
  mode: ProposalMode | undefined,
  session: ProposalMode,
  proposes: boolean,
): boolean {
  if (by === "owner") return mode === "apply" || (mode !== "propose" && !proposes);
  if (by === "claude") return session === "apply" && mode !== "propose";
  return mode === "apply" || session === "apply";
}

/** The parts of a runner that its helpers read (any state and host). */
type AnyParts<O extends BaseOp, X extends object> = Pick<
  RunnerParts<RuleState, CommandHost, O, X>,
  "apply" | "problems" | "proposals" | "mode" | "extra"
>;

/** A result of a command with the defaults, the current switch and the extra fields. */
function resultOf<O extends BaseOp, X extends object>(
  parts: AnyParts<O, X>,
  base: Pick<CommandRun<O>, "command" | "kind" | "title" | "outcome">,
  more: Partial<CommandRun<O>> = {},
): CommandRun<O> & X {
  const run: CommandRun<O> = {
    proposal: null,
    edit: null,
    step: false,
    ops: [],
    pending: [],
    sent: [],
    value: null,
    ...base,
    ...more,
    mode: parts.mode.value,
  };
  return { ...run, ...(parts.extra?.() ?? ({} as X)) };
}

/** Apply an edit as one step of the history. */
function applyOf<O extends BaseOp, X extends object>(
  parts: AnyParts<O, X>,
  edit: Edit<O>,
  command: string,
): CommandRun<O> & X {
  const report = parts.apply(edit);
  const outcome = report.step || report.pending.length > 0 || report.sent.length > 0 ? "applied" : "unchanged";
  return resultOf(
    parts,
    { command, kind: "edit", title: edit.title, outcome },
    { edit: edit.id, step: report.step, ops: edit.ops, pending: report.pending, sent: report.sent },
  );
}

/** Keep an edit as a proposal. The function checks it immediately. The runner applies it when the owner accepts it. */
function proposeOf<O extends BaseOp, X extends object>(
  parts: AnyParts<O, X>,
  id: string,
  ask: { readonly edit: Edit<O>; readonly command: string; readonly args: unknown; readonly by: CommandBy },
): CommandRun<O> & X {
  const { edit, command, args, by } = ask;
  const problems = parts.problems(edit);
  if (problems.length > 0) throw new CommandError(`The edit is not valid. ${problems.join(" ")}`);
  const given = typeof args === "object" && args !== null ? { ...(args as Record<string, unknown>) } : {};
  parts.proposals.value = [...parts.proposals.value, { id, edit, command, args: given, by }];
  return resultOf(
    parts,
    { command, kind: "edit", title: edit.title, outcome: "proposed" },
    { proposal: id, edit: edit.id, ops: edit.ops },
  );
}

/** The chosen ops of the proposals (in their order), the proposals with the other ops, and the actor of the first one. */
function takeOps<O extends BaseOp>(
  proposals: readonly Proposal<O>[],
  keys: readonly string[],
): { readonly chosen: O[]; readonly rest: Proposal<O>[]; readonly actor: Actor | undefined } {
  const wanted = new Set(keys);
  const chosen: O[] = [];
  const rest: Proposal<O>[] = [];
  let actor: Actor | undefined;
  for (const proposal of proposals) {
    const keep: O[] = [];
    proposal.edit.ops.forEach((op, index) => {
      if (!wanted.has(`${proposal.id}:${String(index)}`)) keep.push(op);
      else {
        chosen.push(op);
        actor ??= proposal.edit.actor;
      }
    });
    if (keep.length === proposal.edit.ops.length) rest.push(proposal);
    else if (keep.length > 0) rest.push({ ...proposal, edit: { ...proposal.edit, ops: keep } });
  }
  return { chosen, rest, actor };
}

/** Accept, reject, accept all and reject all of the proposals, and of some of their ops. */
function proposalActions<O extends BaseOp, X extends object>(parts: AnyParts<O, X>): Pick<Runner<O, X>, ProposalKeys> {
  let reviews = 0;
  const accept = (id: string): CommandRun<O> & X => {
    const proposal = parts.proposals.value.find((item) => item.id === id);
    if (proposal === undefined) throw new CommandError(`No proposal "${id}".`);
    parts.proposals.value = parts.proposals.value.filter((item) => item !== proposal);
    return { ...applyOf(parts, proposal.edit, proposal.command), proposal: id };
  };
  return {
    accept,
    reject: (id) => {
      const before = parts.proposals.value.length;
      parts.proposals.value = parts.proposals.value.filter((item) => item.id !== id);
      return parts.proposals.value.length < before;
    },
    acceptAll: () => parts.proposals.value.map((item) => accept(item.id)),
    rejectAll: () => {
      const total = parts.proposals.value.length;
      parts.proposals.value = [];
      return total;
    },
    acceptOps: (keys, title) => {
      const { chosen, rest, actor } = takeOps(parts.proposals.value, keys);
      if (chosen.length === 0) throw new CommandError("No op of a proposal is chosen.");
      reviews += 1;
      const edit: Edit<O> = {
        id: `review#${String(reviews)}`,
        title,
        ops: chosen,
        ...(actor === undefined ? {} : { actor }),
      };
      // The apply throws for a problem before the proposals change.
      const run = applyOf(parts, edit, "review.accept");
      parts.proposals.value = rest;
      return run;
    },
    rejectOps: (keys) => {
      const { chosen, rest } = takeOps(parts.proposals.value, keys);
      parts.proposals.value = rest;
      return chosen.length;
    },
  };
}

/** Make a runner over a registry. */
export function createRunner<S extends RuleState, H extends CommandHost, O extends BaseOp, X extends object = object>(
  parts: RunnerParts<S, H, O, X>,
): Runner<O, X> {
  const count = { edits: 0, proposals: 0 };
  const state = (): S => parts.state(parts.proposals.value.length);
  const actions = proposalActions(parts);
  // The host of the view commands: the functions of the page and the proposal functions of the runner.
  const host = { ...parts.host, ...actions } as unknown as H;
  return {
    ...actions,
    listings: () => parts.registry.listings(state()),
    async run(id, args = {}, options = {}) {
      const by = options.by ?? "script";
      if (options.mode !== undefined && !isProposalMode(options.mode)) {
        throw new CommandError(`The mode is "propose" or "apply", not "${String(options.mode)}".`);
      }
      const command = parts.registry.named(id);
      if (command?.owner === true && by !== "owner") {
        throw new CommandError(`${id} is an action of the owner (the palette of the lab).`);
      }
      const outcome = parts.registry.prepare(id, args, state());
      if (outcome.kind === "view") {
        const value: unknown = await outcome.run(host);
        const base = { command: id, kind: "view", title: outcome.title, outcome: "ran" } as const;
        return resultOf(parts, base, { value: value ?? null });
      }
      count.edits += 1;
      const actor = actorOf(by, options.actor);
      const edit: Edit<O> = { id: `${id}#${String(count.edits)}`, title: outcome.title, ops: outcome.ops, actor };
      if (appliesAtOnce(by, options.mode, parts.mode.value, command?.proposes === true))
        return applyOf(parts, edit, id);
      // The count increases only when the proposal is valid. Thus the IDs have no gap.
      const proposed = proposeOf(parts, `p${String(count.proposals + 1)}`, { edit, command: id, args, by });
      count.proposals += 1;
      return proposed;
    },
    propose(edit, command, args, by) {
      count.edits += 1;
      const full: Edit<O> = { ...edit, id: `${command}#${String(count.edits)}` };
      const proposed = proposeOf(parts, `p${String(count.proposals + 1)}`, { edit: full, command, args, by });
      count.proposals += 1;
      return proposed;
    },
    setMode(next) {
      if (!isProposalMode(next)) throw new CommandError(`The mode is "propose" or "apply", not "${String(next)}".`);
      parts.mode.value = next;
      (parts.keepMode ?? keepProposalMode)(next);
      return next;
    },
  };
}
