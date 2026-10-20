// SPDX-License-Identifier: Apache-2.0
/**
 * The groups of parallel tasks in the editor window. A group gives one prompt to many agents (variants) or one part of
 * the work to each agent (split). Each task has its own session, so its changes wait in Review as its own change sets.
 * The grid of frames shows the view after the change sets of each task. "Keep" accepts the change sets of one task and
 * rejects the change sets of the other tasks. "Merge" accepts all of them.
 */
import type { ChangeSet } from "@scenity/editor-core";
import type { PageOp } from "../hierarchy/sceneCommands";
import type { AgentTaskInfo, TaskGroupInfo } from "./agentClient";

/** A group of parallel tasks with its tasks in their order. */
export interface TaskGroupView {
  readonly id: string;
  readonly kind: TaskGroupInfo["kind"];
  readonly tasks: readonly AgentTaskInfo[];
  /** True when each task of the group is at its end. */
  readonly ended: boolean;
}

/** What a keep and a merge use of Review. */
export interface GroupReview {
  readonly sets: { readonly value: readonly ChangeSet<PageOp>[] };
  accept(set: ChangeSet<PageOp>, keys: readonly string[]): string | null;
  reject(set: ChangeSet<PageOp>, keys: readonly string[]): void;
}

const running = (task: AgentTaskInfo): boolean => task.state === "running" || task.state === "checking";

/** The groups of a list of tasks, the newest first. */
export function taskGroups(tasks: readonly AgentTaskInfo[]): TaskGroupView[] {
  const groups = new Map<string, AgentTaskInfo[]>();
  for (const task of tasks) {
    if (task.group === undefined) continue;
    groups.set(task.group.id, [...(groups.get(task.group.id) ?? []), task]);
  }
  return [...groups].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
    return { id, kind: sorted[0]?.group?.kind ?? "variants", tasks: sorted, ended: !sorted.some(running) };
  });
}

/** The change sets of a session that wait in Review. */
function setsOf(review: GroupReview, session: string): ChangeSet<PageOp>[] {
  return review.sets.value.filter((set) => set.actor.session === session);
}

/** Accept all the ops of each change set of a session. Return the reason of the first refusal, or null. */
function acceptSession(review: GroupReview, session: string): string | null {
  for (const set of setsOf(review, session)) {
    const reason = review.accept(
      set,
      set.ops.map((op) => op.key),
    );
    if (reason !== null) return reason;
  }
  return null;
}

/** Keep one task of a group: accept its change sets and reject the change sets of the other tasks. */
export function keepTask(review: GroupReview, group: TaskGroupView, session: string): string | null {
  const reason = acceptSession(review, session);
  if (reason !== null) return reason;
  for (const task of group.tasks) {
    if (task.session === session) continue;
    for (const set of setsOf(review, task.session))
      review.reject(
        set,
        set.ops.map((op) => op.key),
      );
  }
  return null;
}

/** Merge a group: accept the change sets of each task, in the order of the group. */
export function mergeGroup(review: GroupReview, group: TaskGroupView): string | null {
  for (const task of group.tasks) {
    const reason = acceptSession(review, task.session);
    if (reason !== null) return reason;
  }
  return null;
}
