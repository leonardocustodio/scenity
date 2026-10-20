// SPDX-License-Identifier: Apache-2.0
/**
 * Atomic batches of commands: a tool call with many commands applies all of them or none, and makes one named step of
 * the history. Each step builds on the document of the step before it, so the page applies the steps one by one after
 * a mark of the history. A step that fails returns the history to the mark, so the document does not change. At the
 * end, the steps fold into one step with the title of the batch. For an agent in the proposal mode, the history returns
 * to the mark and the ops of the batch wait as one proposal.
 */
import {
  actorOf,
  appliesAtOnce,
  CommandError,
  type BaseOp,
  type CommandOptions,
  type CommandRun,
  type HistoryMark,
  type ProposalMode,
  type Runner,
  type StepLabel,
} from "@scenity/editor-core";

/** One step of a batch: a command and its arguments. */
export interface BatchStep {
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** The parts of the page that a batch uses. */
export interface BatchParts<O extends BaseOp> {
  readonly runner: Runner<O>;
  readonly history: {
    mark(): HistoryMark;
    rewind(mark: HistoryMark): void;
    squash(mark: HistoryMark, label: StepLabel): boolean;
  };
  /** The switch of the session now. */
  mode(): ProposalMode;
}

/** The most steps of one batch. */
export const BATCH_MAX = 200;

/** Run the steps of a batch as one step of the history (or one proposal); a failed step changes nothing. */
export async function runBatch<O extends BaseOp>(
  parts: BatchParts<O>,
  steps: readonly BatchStep[],
  title: string,
  options: CommandOptions = {},
): Promise<CommandRun<O>> {
  if (steps.length === 0 || steps.length > BATCH_MAX) {
    throw new CommandError(`A batch has 1 to ${String(BATCH_MAX)} steps, not ${String(steps.length)}.`);
  }
  const by = options.by ?? "script";
  const actor = actorOf(by, options.actor);
  const owned = new Set(parts.runner.listings().flatMap((item) => (item.owner ? [item.id] : [])));
  const mark = parts.history.mark();
  const ops: O[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      if (by !== "owner" && owned.has(step.command)) throw new CommandError("only the person runs this command.");
      // Each step applies immediately on top of the step before it; the batch decides at the end.
      const run = await parts.runner.run(step.command, step.args ?? {}, { by: "owner", mode: "apply", actor });
      ops.push(...run.ops);
    } catch (error) {
      parts.history.rewind(mark);
      const reason = error instanceof Error ? error.message : String(error);
      throw new CommandError(`Step ${String(index + 1)} (${step.command}): ${reason} Nothing changed.`);
    }
  }
  const id = `batch#${String(Date.now())}`;
  if (appliesAtOnce(by, options.mode, parts.mode(), false)) {
    const step = parts.history.squash(mark, { id, title, actor });
    const outcome = step ? "applied" : "unchanged";
    return { ...emptyRun<O>(parts.mode()), command: "batch", title, outcome, edit: id, step, ops };
  }
  parts.history.rewind(mark);
  return parts.runner.propose({ title, ops, actor }, "batch", { steps }, by);
}

/** A run result with no change, for the fields that a batch fills. */
function emptyRun<O extends BaseOp>(mode: ProposalMode): Omit<CommandRun<O>, "command" | "title" | "outcome"> {
  return { kind: "edit", proposal: null, edit: null, step: false, ops: [], pending: [], sent: [], value: null, mode };
}
