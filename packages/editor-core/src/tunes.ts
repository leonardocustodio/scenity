// SPDX-License-Identifier: Apache-2.0
/**
 * The tune ops: an op kind of the channel `tunes`. A tune op sets one tune value (`@scenity/scene/tuning`, a path such
 * as `room.props.cart.at.0`). Null resets it to its default. The tune values are an input of a frame (the `tune` URL
 * parameter). Thus an edit gives the same frame as the same values in the URL.
 * A plugin that edits tune values registers `TUNE_OP`. The functions are pure. No Vue import.
 */
import { defineOpKind, opsOfKind, type BaseOp, type TuneOp } from "./ops";

export type Tunes = Readonly<Record<string, number>>;

/**
 * The tune values with one value set. Null, or a value equal to the fallback (the default), removes the path, as the
 * tune API of the editor does.
 */
export function withTuneValue(
  values: Tunes,
  path: string,
  value: number | null,
  fallback?: number,
): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(values).filter(([key]) => key !== path));
  return value === null || value === fallback ? rest : { ...rest, [path]: value };
}

/** True when two records of tune values have the same paths and values. */
export function sameTunes(a: Tunes, b: Tunes): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function tuneOps(ops: readonly BaseOp[]): TuneOp[] {
  return opsOfKind<TuneOp>(ops, "tune");
}

/** The tune values after the tune ops, in their order. Null, or a value equal to the default, removes the path. */
export function applyTuneOps(
  tunes: Tunes,
  ops: readonly BaseOp[],
  defaults: ReadonlyMap<string, number>,
): Record<string, number> {
  let next: Record<string, number> = { ...tunes };
  for (const op of tuneOps(ops)) next = withTuneValue(next, op.path, op.value, defaults.get(op.path));
  return next;
}

/** The op kind of the tune values (channel `tunes`). */
export const TUNE_OP = defineOpKind<TuneOp, Tunes>({
  kind: "tune",
  channel: "tunes",
  problem(op, context) {
    if (typeof op.path !== "string" || !context.known(op.path)) return `no tuned number "${String(op.path)}".`;
    if (op.value !== null && !(typeof op.value === "number" && Number.isFinite(op.value))) {
      return "the value of a tune op is a finite number or null.";
    }
    return null;
  },
  apply: (tunes, op, context) => withTuneValue(tunes, op.path, op.value, context.defaults.get(op.path)),
});
