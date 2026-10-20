// SPDX-License-Identifier: Apache-2.0
/**
 * The review state of the page: the change sets that wait, the ops that the person checked (all by default), the marks
 * of the changed entities and fields in the colour of their session, and the result of each review (what the person
 * accepted and rejected), which goes to the agent with its next prompt. The page has one review state (`pageReview`);
 * the Review panel, the hierarchy, the inspector, the view and the agent panel read it.
 */
import { shallowRef, type ShallowRef } from "vue";
import type { ChangeSet } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { t } from "../../texts";
import { actorColour } from "../actorColour";
import type { PageOp, SceneCommands } from "../hierarchy/sceneCommands";
import { reviewSet } from "./reviewModel";

/** The mark of a changed entity. */
export interface EntityMark {
  readonly change: "added" | "removed" | "changed" | "moved";
  /** The CSS colour of the session. */
  readonly colour: string;
  /** The name of the session. */
  readonly by: string;
}

/** The mark of a changed field (`<entity>:<field>`): the old and the new value, and the ops of the change. */
export interface FieldMark {
  readonly colour: string;
  readonly by: string;
  readonly before: string;
  readonly after: string;
  /** The key of the change set and the keys of its ops on the field (Accept and Reject beside the field). */
  readonly set: string;
  readonly keys: readonly string[];
}

/** What the person did with a change set so far. */
interface ReviewResult {
  readonly session: string;
  readonly turn: number;
  readonly accepted: string[];
  readonly rejected: string[];
}

export interface ReviewState {
  readonly sets: ShallowRef<readonly ChangeSet<PageOp>[]>;
  /** The ops that the person did not check (all others are checked). */
  readonly unchecked: ShallowRef<ReadonlySet<string>>;
  readonly entities: ShallowRef<ReadonlyMap<string, EntityMark>>;
  readonly fields: ShallowRef<ReadonlyMap<string, FieldMark>>;
  /** The ops whose value the person changed after the agent (a conflict: the person's value stays by default). */
  readonly conflicts: ShallowRef<ReadonlySet<string>>;
  /** The count of the ops that wait. */
  count(): number;
  /** Accept the ops (keys) of a change set as one step; the reason of a refusal, or null. */
  accept(set: ChangeSet<PageOp>, keys: readonly string[]): string | null;
  reject(set: ChangeSet<PageOp>, keys: readonly string[]): void;
  /** The ops of a set that the person checked. */
  checked(set: ChangeSet<PageOp>): string[];
  toggle(keys: readonly string[], on: boolean): void;
  /** The result of the last review of a session for its agent, or null. */
  feedback(session: string): string | null;
  /** Read the change sets again (the page calls it after each change of the proposals or of the document). */
  refresh(): void;
  /**
   * The person changed values (`set` pointers): each waiting op that sets one of them, or a value in it, gets a
   * conflict mark and leaves the checked ops.
   */
  personChanged(paths: readonly string[]): void;
  /** Accept or reject the change of a marked field (Accept and Reject beside the field). */
  acceptMark(mark: FieldMark): string | null;
  rejectMark(mark: FieldMark): void;
  /** The mark of a field of one of the entities (`components.light.colour`), or of a part above it; or null. */
  fieldMark(ids: readonly string[], field: string): FieldMark | null;
}

/** The step title of an accept: the name of the session and the title of the set ("Chairs: Add four chairs"). */
export function acceptTitle(set: Pick<ChangeSet, "actor" | "title">): string {
  return set.actor.name === undefined ? set.title : `${set.actor.name}: ${set.title}`;
}

/** The marks of the change sets on the current document. */
function marksOf(sets: readonly ChangeSet<PageOp>[], doc: SceneDocument) {
  const entities = new Map<string, EntityMark>();
  const fields = new Map<string, FieldMark>();
  for (const set of sets) {
    const colour = actorColour(set.actor);
    const by = set.actor.name ?? "";
    for (const row of reviewSet(set, doc).rows) {
      if (row.entity === null) continue;
      entities.set(row.entity, { change: row.change, colour, by });
      for (const op of row.ops) {
        if (op.field === "") continue;
        const key = `${row.entity}:${op.field}`;
        const keys = [...(fields.get(key)?.keys ?? []), op.key];
        fields.set(key, { colour, by, before: op.before, after: op.after, set: set.key, keys });
      }
    }
  }
  return { entities, fields };
}

/** What the person did with the change sets of agent turns, and the feedback of each session. */
function reviewResults(doc: () => SceneDocument) {
  const open = new Map<string, ReviewResult>();
  const finished = new Map<string, ReviewResult>();
  return {
    /** The descriptions of ops of a set ("Lamp name"), read on the current document. */
    describe(set: ChangeSet<PageOp>, keys: readonly string[]): string[] {
      const wanted = new Set(keys);
      return reviewSet(set, doc()).rows.flatMap((row) =>
        row.ops
          .filter((op) => wanted.has(op.key))
          .map((op) => [row.name, op.field].filter((part) => part !== "").join(" ")),
      );
    },
    /** Keep what the person did with ops of a set of an agent turn. */
    note(set: ChangeSet<PageOp>, kind: "accepted" | "rejected", described: readonly string[]): void {
      const { session, turn } = set.actor;
      if (session === undefined || turn === undefined) return;
      const result = open.get(set.key) ?? { session, turn, accepted: [], rejected: [] };
      result[kind].push(...described);
      open.set(set.key, result);
    },
    /** A set with no op left is a finished review: it becomes the feedback of its session. */
    finish(sets: readonly ChangeSet<PageOp>[]): void {
      for (const [key, result] of open) {
        if (sets.some((set) => set.key === key)) continue;
        finished.set(result.session, result);
        open.delete(key);
      }
    },
    feedback(session: string): string | null {
      const result = finished.get(session);
      if (result === undefined) return null;
      const total = result.accepted.length + result.rejected.length;
      const rejected =
        result.rejected.length === 0 ? "" : t("review-feedback-rejected", { list: result.rejected.join(", ") });
      return `${t("review-feedback", { turn: result.turn, accepted: result.accepted.length, total })}${rejected}`;
    },
  };
}

/** The keys of the ops whose entity is gone from the document. */
function staleKeys(sets: readonly ChangeSet<PageOp>[], doc: SceneDocument): string[] {
  return sets
    .flatMap((set) => reviewSet(set, doc).rows.filter((row) => row.stale))
    .flatMap((row) => row.ops.map((op) => op.key));
}

/** True when one pointer is the other or a part of it. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** The keys of the waiting `set` ops on the values that the person changed. */
function conflictKeys(sets: readonly ChangeSet<PageOp>[], doc: SceneDocument, paths: readonly string[]): string[] {
  return sets
    .flatMap((set) => reviewSet(set, doc).rows.flatMap((row) => row.ops))
    .filter((op) => op.path !== null && paths.some((path) => overlaps(path, op.path ?? "")))
    .map((op) => op.key);
}

/** Make the review state over the commands and the document of the page. */
export function createReviewState(commands: SceneCommands, doc: () => SceneDocument): ReviewState {
  const sets = shallowRef<readonly ChangeSet<PageOp>[]>([]);
  const unchecked = shallowRef<ReadonlySet<string>>(new Set());
  const entities = shallowRef<ReadonlyMap<string, EntityMark>>(new Map());
  const fields = shallowRef<ReadonlyMap<string, FieldMark>>(new Map());
  const conflicts = shallowRef<ReadonlySet<string>>(new Set());
  const results = reviewResults(doc);
  const refresh = (): void => {
    const next = commands.changeSets();
    results.finish(next);
    sets.value = next;
    // A stale op (its entity is gone) leaves the checked ops.
    const stale = staleKeys(next, doc()).filter((key) => !unchecked.value.has(key));
    if (stale.length > 0) unchecked.value = new Set([...unchecked.value, ...stale]);
    const marks = marksOf(next, doc());
    entities.value = marks.entities;
    fields.value = marks.fields;
  };
  return {
    sets,
    unchecked,
    entities,
    fields,
    conflicts,
    personChanged: (paths) => {
      const keys = conflictKeys(sets.value, doc(), paths);
      if (keys.length === 0) return;
      conflicts.value = new Set([...conflicts.value, ...keys]);
      unchecked.value = new Set([...unchecked.value, ...keys]);
    },
    count: () => sets.value.reduce((total, set) => total + set.ops.length, 0),
    accept: (set, keys) => {
      // The descriptions read the document before the accept changes it.
      const described = results.describe(set, keys);
      try {
        commands.acceptOps(keys, acceptTitle(set));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      results.note(set, "accepted", described);
      refresh();
      return null;
    },
    reject: (set, keys) => {
      results.note(set, "rejected", results.describe(set, keys));
      commands.rejectOps(keys);
      refresh();
    },
    checked: (set) => set.ops.map((op) => op.key).filter((key) => !unchecked.value.has(key)),
    toggle: (keys, on) => {
      const next = new Set(unchecked.value);
      for (const key of keys) {
        if (on) next.delete(key);
        else next.add(key);
      }
      unchecked.value = next;
    },
    feedback: (session) => results.feedback(session),
    acceptMark(mark) {
      const set = sets.value.find((item) => item.key === mark.set);
      return set === undefined ? null : this.accept(set, mark.keys);
    },
    rejectMark(mark) {
      const set = sets.value.find((item) => item.key === mark.set);
      if (set !== undefined) this.reject(set, mark.keys);
    },
    refresh,
    fieldMark: (ids, field) => {
      const parts = field.split(".");
      for (const id of ids) {
        for (let size = parts.length; size > 0; size -= 1) {
          const mark = fields.value.get(`${id}:${parts.slice(0, size).join(".")}`);
          if (mark !== undefined) return mark;
        }
      }
      return null;
    },
  };
}

/** The review state of the page: a reactive cell, so a reader that comes before the start follows it. */
const current = shallowRef<ReviewState | null>(null);

/** The review state of the page, or null before the edit mode starts it. */
export function pageReview(): ReviewState | null {
  return current.value;
}

export function setPageReview(state: ReviewState | null): void {
  current.value = state;
}
