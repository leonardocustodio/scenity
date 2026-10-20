// SPDX-License-Identifier: Apache-2.0
/**
 * The edit ops: the one shape of every edit. An edit is an input, never a hidden change of the scene. An edit is a
 * named list of ops, and each op has a kind:
 *
 * - `scene`: one scene op of the patch model of `@scenity/scene` (set, add, remove, move, addComponent,
 *   removeComponent) on the scene document;
 * - `source`: a change of the source through a known tool. The editor does not apply it. It returns it as a pending
 *   run, and the host runs the tool;
 * - a kind of a plugin (`defineOpKind`): for example the tune values (tunes.ts) or the events of a take (events.ts).
 *
 * An op kind names the channel of the edit state that it changes (history.ts: the scene document, the tune values,
 * the events, the scratch list). The functions here are pure. No Vue import.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { opSchema, type SceneOp } from "@scenity/scene/schema/entity";

/** The base of every op: its kind. */
export interface BaseOp {
  readonly kind: string;
}

/** One scene op on the scene document. */
export interface SceneEditOp {
  readonly kind: "scene";
  readonly op: SceneOp;
}

/** A change of the source through a known tool, with the arguments of the tool. */
export interface SourceOp {
  readonly kind: "source";
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** A change of one tune value. Null resets the value to its default (tunes.ts). */
export interface TuneOp {
  readonly kind: "tune";
  readonly path: string;
  readonly value: number | null;
}

/** One event that goes into the live sequence at its time (events.ts). `E` is the event type of a plugin. */
export interface EventOp<E = unknown> {
  readonly kind: "event";
  readonly event: E;
}

/** The ops that the editor core knows. An editor narrows the list to its own kinds. */
export type EditOp = SceneEditOp | SourceOp | TuneOp | EventOp;

/**
 * Who made an edit: the person, an agent session (its name and its colour), a script or a plugin. The history keeps it
 * with each step. The History panel and the activity log show it.
 */
export interface Actor {
  readonly kind: "person" | "agent" | "script" | "plugin";
  /** The name of the agent session or of the plugin. */
  readonly name?: string;
  /** The colour of the agent session: a colour token of the studio (`agent-1` to `agent-6`) or a CSS colour. */
  readonly colour?: string;
  /** The ID of the agent session. */
  readonly session?: string;
  /** The turn of the session (1 for the first prompt). The edits of one turn form one change set. */
  readonly turn?: number;
}

/** The actor of an edit with no actor: the person. */
export const PERSON: Actor = { kind: "person" };

/** An edit: a named list of ops that is one step of the history. */
export interface Edit<O extends BaseOp = EditOp> {
  readonly id: string;
  readonly title: string;
  readonly ops: readonly O[];
  /** Who made the edit (absent: the person). */
  readonly actor?: Actor;
}

/** A source op of an applied edit that waits for a run of its tool. */
export interface PendingRun {
  /** The ID of the edit. */
  readonly edit: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** What an op kind reads: which tune paths exist and their defaults. */
export interface OpContext {
  known(path: string): boolean;
  readonly defaults: ReadonlyMap<string, number>;
}

/** A refusal of an op when the editor applies it (for example a scene op on an entity that does not exist). */
export class EditError extends Error {
  override readonly name = "EditError";
}

/**
 * An op kind (the extension point of the plugins): its name, the channel of the edit state that it changes, the check
 * of an op and its apply. `channel: null` means that the editor does not apply the op (a source op waits as a run).
 */
export interface OpKind<O extends BaseOp = BaseOp, V = unknown> {
  readonly kind: string;
  readonly channel: string | null;
  /** Why the op is not valid, or null. The fields of the op are not checked yet. Read them as unknown values. */
  problem(op: Readonly<Record<string, unknown>>, context: OpContext): string | null;
  /** The value of the channel after the op. A refusal throws an EditError. */
  apply?(value: V, op: O, context: OpContext): V;
}

/** Define an op kind. */
export function defineOpKind<O extends BaseOp, V>(kind: OpKind<O, V>): OpKind<O, V> {
  if (!/^[a-z][A-Za-z0-9.]*$/.test(kind.kind)) throw new Error(`The op kind "${kind.kind}" is not a name.`);
  if (kind.channel !== null && kind.apply === undefined) throw new Error(`The op kind "${kind.kind}" has no apply.`);
  return kind;
}

/** The source ops: the editor returns them as pending runs. */
export const SOURCE_OP = defineOpKind<SourceOp, never>({
  kind: "source",
  channel: null,
  problem(op) {
    if (typeof op.tool !== "string" || op.tool === "") return "a source op names its tool.";
    return typeof op.args === "object" && op.args !== null ? null : "the args of a source op are an object.";
  },
});

/** The scene ops on the scene document of the channel `scene`, checked by the component registry. */
export function sceneOpKind(registry: ComponentRegistry): OpKind<SceneEditOp, EntityDocument> {
  return defineOpKind<SceneEditOp, EntityDocument>({
    kind: "scene",
    channel: "scene",
    problem(op) {
      const shape = opSchema.safeParse(op.op);
      return shape.success ? null : `the scene op is not valid (${shape.error.issues[0]?.message ?? "no reason"}).`;
    },
    apply(doc, op) {
      const result = applyOps(doc, [op.op], registry);
      if (!result.ok) throw new EditError(result.reason);
      return result.doc;
    },
  });
}

/** The ops of one kind. */
export function opsOfKind<O extends BaseOp>(ops: readonly BaseOp[], kind: O["kind"]): O[] {
  return ops.filter((op): op is O => op.kind === kind);
}

export function sourceOps(ops: readonly BaseOp[]): SourceOp[] {
  return opsOfKind<SourceOp>(ops, "source");
}

/** The source ops of an edit as pending runs: the editor does not apply them. */
export function pendingRuns(edit: Edit<BaseOp>): PendingRun[] {
  return sourceOps(edit.ops).map((op) => ({ edit: edit.id, tool: op.tool, args: op.args }));
}

/** The problems of an edit (empty: the edit is good), with the op kinds of the editor. */
export function editProblems(edit: unknown, kinds: readonly OpKind[], context: OpContext): string[] {
  const value = edit as Partial<Edit<BaseOp>> | null;
  if (typeof value !== "object" || value === null) return ["An edit is an object { id, title, ops }."];
  const problems: string[] = [];
  if (typeof value.id !== "string" || value.id === "") problems.push("The edit has no id.");
  if (typeof value.title !== "string") problems.push("The edit has no title.");
  if (!Array.isArray(value.ops)) return [...problems, "The edit has no list of ops."];
  (value.ops as unknown[]).forEach((op, index) => {
    const problem = opProblem(op, kinds, context);
    if (problem !== null) problems.push(`Op ${String(index)}: ${problem}`);
  });
  return problems;
}

function opProblem(op: unknown, kinds: readonly OpKind[], context: OpContext): string | null {
  if (typeof op !== "object" || op === null) return "an op is an object.";
  const item = op as Readonly<Record<string, unknown>>;
  const kind = kinds.find((entry) => entry.kind === item.kind);
  if (kind === undefined) {
    return `no op kind "${String(item.kind)}" (${kinds.map((entry) => entry.kind).join(", ")}).`;
  }
  return kind.problem(item, context);
}

/** The values of the channels after the ops of an edit, and the names of the channels that the ops changed. */
export interface AppliedOps {
  readonly values: Readonly<Record<string, unknown>>;
  readonly touched: readonly string[];
}

/**
 * Apply the ops of an edit to the values of the channels, in their order. An op without a channel (a source op) does
 * not change a value. An unknown kind, a missing channel or a refusal of an op throws an EditError.
 */
export function applyEditOps(
  values: Readonly<Record<string, unknown>>,
  ops: readonly BaseOp[],
  kinds: readonly OpKind[],
  context: OpContext,
): AppliedOps {
  const next: Record<string, unknown> = { ...values };
  const touched = new Set<string>();
  for (const op of ops) {
    const kind = kinds.find((entry) => entry.kind === op.kind);
    if (kind === undefined) throw new EditError(`No op kind "${op.kind}".`);
    if (kind.channel === null || kind.apply === undefined) continue;
    if (!Object.hasOwn(next, kind.channel)) {
      throw new EditError(`The editor has no channel "${kind.channel}" for the op kind "${kind.kind}".`);
    }
    next[kind.channel] = kind.apply(next[kind.channel], op, context);
    touched.add(kind.channel);
  }
  return { values: next, touched: [...touched] };
}
