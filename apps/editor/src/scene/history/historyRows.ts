// SPDX-License-Identifier: Apache-2.0
/**
 * The History panel of the editor window (the panel `history`): the undo stack with the name and the actor of each
 * step, and the steps of one agent turn (one change set) as a group. A click on a step goes to it in one action, and
 * one redo (or undo) reverts that action. The command `history.goTo` does the same
 * for a script or an agent.
 */
import { shallowRef, type ShallowRef } from "vue";
import type { Actor, EditHistory } from "@scenity/editor-core";
import { t } from "../../texts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";

/** One step of the panel. */
export interface HistoryRow {
  readonly index: number;
  readonly title: string;
  readonly actor: Actor | null;
  /** The change set of an agent turn (`<session>#<turn>`), or null. */
  readonly set: string | null;
  /** True for the step now; a step after it is undone. */
  readonly current: boolean;
  readonly undone: boolean;
}

/** A group of steps: the steps of one agent turn, or one step of another actor. */
export interface HistoryGroup {
  readonly key: string;
  readonly set: string | null;
  readonly actor: Actor | null;
  readonly rows: readonly HistoryRow[];
}

/** The rows of the steps of a history, the oldest first. */
export function historyRows(history: Pick<EditHistory, "steps">): HistoryRow[] {
  const { index, steps } = history.steps();
  return steps.map((step, at) => {
    const actor = step.label?.actor ?? null;
    const set =
      actor?.session !== undefined && actor.turn !== undefined ? `${actor.session}#${String(actor.turn)}` : null;
    return {
      index: at,
      title: step.label === null ? t("history-start") : step.label.title,
      actor,
      set,
      current: at === index,
      undone: at > index,
    };
  });
}

/** The rows in groups: the steps that follow one another with the same change set make one group. */
export function historyGroups(rows: readonly HistoryRow[]): HistoryGroup[] {
  const groups: { key: string; set: string | null; actor: Actor | null; rows: HistoryRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (row.set !== null && last?.set === row.set) last.rows.push(row);
    else groups.push({ key: `g${String(row.index)}`, set: row.set, actor: row.actor, rows: [row] });
  }
  return groups;
}

/** The rows of a history as a reactive value that follows its changes; the result stops it too. */
export function watchHistory(history: Pick<EditHistory, "steps" | "listen">): {
  readonly rows: ShallowRef<readonly HistoryRow[]>;
  stop(): void;
} {
  const rows = shallowRef<readonly HistoryRow[]>(historyRows(history));
  const stop = history.listen(() => {
    rows.value = historyRows(history);
  });
  return { rows, stop };
}

/** The command `history.goTo`: go to a step of the history (its index in the panel) in one action. */
export function goToCommand(goTo: (index: number) => boolean): PageKeyCommandSpec {
  return {
    id: "history.goTo",
    title: t("command-history-go-to"),
    category: "history",
    description: "Go to a step of the undo history in one action; one redo (or undo) takes the action back.",
    args: { step: { type: "number", description: "The index of the step (0: the start of the history)." } },
    agents: true,
    run: (args) => {
      if (!goTo(Number(args.step))) throw new Error(t("history-go-to-none", { step: String(args.step) }));
    },
  };
}
