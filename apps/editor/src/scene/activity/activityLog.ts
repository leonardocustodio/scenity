// SPDX-License-Identifier: Apache-2.0
/**
 * The activity log of the editor window (the `activity` panel). Each run of a scene command, by the person or an
 * agent, is one line: the actor, the command, its arguments, its title and its outcome. A line copies as a call of the
 * script API or as a prompt for an agent. The lines that applied replay in their order into a copy of the scene. The
 * replay gives the same document.
 */
import { markRaw, shallowRef } from "vue";
import { PERSON, type Actor } from "@scenity/editor-core";
import { t } from "../../texts";

/** One line of the log. */
export interface ActivityEntry {
  readonly id: number;
  /** The time of the run (ms since the epoch). */
  readonly at: number;
  readonly actor: Actor;
  /** The command, or "batch" for a batch of commands (the steps are in `args.steps`). */
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly title: string;
  /** "applied", "proposed", "unchanged" or "ran" (a view command). */
  readonly outcome: string;
}

/** The most lines that the log keeps. */
export const ACTIVITY_MAX = 500;

/** The call of a line in the script API, for example `__scenity.command("entity.move", { … })`. */
export function scriptText(entry: Pick<ActivityEntry, "command" | "args" | "title">): string {
  if (entry.command === "batch") {
    return `__scenity.commandBatch(${JSON.stringify(entry.args.steps ?? [])}, ${JSON.stringify(entry.title)})`;
  }
  return `__scenity.command(${JSON.stringify(entry.command)}, ${JSON.stringify(entry.args)})`;
}

/** A line as a prompt for an agent (a Fluent text: the person copies it). */
export function promptText(entry: Pick<ActivityEntry, "command" | "args" | "title">): string {
  if (entry.command === "batch") {
    return t("activity-prompt-batch", { title: entry.title, steps: JSON.stringify(entry.args.steps ?? []) });
  }
  return t("activity-prompt-command", { command: entry.command, args: JSON.stringify(entry.args), title: entry.title });
}

/** The log of one page. */
export class ActivityLog {
  readonly entries = shallowRef<readonly ActivityEntry[]>([]);
  #next = 1;

  constructor() {
    markRaw(this);
  }

  /** Add a line and return its ID. */
  record(entry: Omit<ActivityEntry, "id" | "at" | "actor"> & { readonly actor?: Actor }): number {
    const line: ActivityEntry = { ...entry, id: this.#next++, at: Date.now(), actor: entry.actor ?? PERSON };
    this.entries.value = [...this.entries.value, line].slice(-ACTIVITY_MAX);
    return line.id;
  }

  /** Give a line another outcome. "adjusted" means that a new run took its place, so a replay ignores it. */
  mark(id: number, outcome: string): void {
    this.entries.value = this.entries.value.map((entry) => (entry.id === id ? { ...entry, outcome } : entry));
  }

  clear(): void {
    this.entries.value = [];
  }
}

let current: ActivityLog | null = null;

/** The activity log of this page. */
export function pageActivity(): ActivityLog {
  current ??= new ActivityLog();
  return current;
}

/** The lines of a log that changed the scene, in their order (a replay runs them). */
export function replayLines(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return entries.filter((entry) => entry.outcome === "applied");
}
