// SPDX-License-Identifier: Apache-2.0
/**
 * The posed view of the editor. The gizmo and the inspector show the scene at the time of the clock (the base scene
 * with the sequence values at `t`), not the base scene. An edit in the posed view gives ops on the posed scene.
 * `unposeOps` changes them into ops on the base scene that make the same change. A position adds the change, a
 * rotation turns by it, a scale multiplies it and a number adds it. Thus the record mode (record.ts) keys the value
 * that the owner sees. Pure. No Vue import, no DOM.
 */
import {
  getAt,
  jsonEqual,
  parsePointer,
  qconjugate,
  qmul,
  qnormalize,
  type ComponentRegistry,
  type Quat,
} from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp, SetOp } from "@scenity/scene/schema/entity";
import { createEvaluator, type Evaluator, type SequenceDocument } from "@scenity/scene/sequence";
import { TRANSFORM_DEFAULTS } from "../sequence/tracks";

/** The scene at a time with a memo: the same scene, sequence and time give the same object. */
export class PosedView {
  readonly #registry: ComponentRegistry;
  #evaluator: Evaluator | null = null;
  #scene: SceneDocument | null = null;
  #sequence: SequenceDocument | null = null;
  #t = -1;
  #posed: SceneDocument | null = null;

  constructor(registry: ComponentRegistry) {
    this.#registry = registry;
  }

  /** The scene at the time `t` (ms) of the sequence. The scene itself with no sequence or when the evaluator fails. */
  at(scene: SceneDocument, sequence: SequenceDocument | null, t: number): SceneDocument {
    if (sequence === null) return scene;
    const time = Math.min(Math.max(0, Math.round(t)), sequence.duration);
    if (scene === this.#scene && sequence === this.#sequence && time === this.#t && this.#posed !== null) {
      return this.#posed;
    }
    try {
      if (scene !== this.#scene || sequence !== this.#sequence || this.#evaluator === null) {
        this.#evaluator = createEvaluator({ scene, sequence, registry: this.#registry });
      }
      this.#posed = this.#evaluator.at(time).scene;
    } catch {
      this.#evaluator = null;
      this.#posed = scene;
    }
    this.#scene = scene;
    this.#sequence = sequence;
    this.#t = time;
    return this.#posed;
  }
}

type Numbers = readonly number[];

function isNumbers(value: unknown): value is Numbers {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

/** The base value that makes the change from `posed` to `next` on top of `base` (see the module comment). */
function unposeValue(base: unknown, posed: unknown, next: unknown, tokens: readonly string[]): unknown {
  const part = tokens[3] === "transform" ? tokens[4] : undefined;
  const whole = tokens.length === 5;
  if (part === "rotation" && whole && isNumbers(base) && isNumbers(posed) && isNumbers(next) && next.length === 4) {
    return qnormalize(
      qmul(qmul(next as unknown as Quat, qconjugate(posed as unknown as Quat)), base as unknown as Quat),
    );
  }
  const scale = part === "scale";
  const one = (b: number, p: number, n: number): number => (scale ? (p === 0 ? n : (b * n) / p) : b + n - p);
  if (typeof base === "number" && typeof posed === "number" && typeof next === "number") return one(base, posed, next);
  if (isNumbers(base) && isNumbers(posed) && isNumbers(next) && base.length === next.length) {
    return base.map((value, index) => one(value, posed[index] ?? value, next[index] ?? value));
  }
  return next;
}

/** The value at the tokens of a base scene, with the transform default for a part that the entity does not have. */
function baseValue(base: SceneDocument, tokens: readonly string[]): unknown {
  const value = getAt(base, tokens);
  if (value !== undefined || tokens[3] !== "transform" || getAt(base, tokens.slice(0, 2)) === undefined) return value;
  const part = tokens[4];
  if (part !== "position" && part !== "rotation" && part !== "scale") return undefined;
  const whole = TRANSFORM_DEFAULTS[part];
  return tokens.length === 5 ? whole : tokens.length === 6 ? whole[Number(tokens[5])] : undefined;
}

/**
 * The ops on the base scene that make the change of `ops` on the posed scene. A `set` of a value that the sequence
 * does not change, or of a value that the base scene does not hold (a transform part has its default), stays as it is.
 * The other ops also stay.
 */
export function unposeOps(base: SceneDocument, posed: SceneDocument, ops: readonly SceneOp[]): SceneOp[] {
  if (base === posed) return [...ops];
  return ops.map((op): SceneOp => {
    if (op.op !== "set" || op.value === undefined) return op;
    const tokens = parsePointer(op.path);
    if (tokens?.[0] !== "entities" || tokens[2] !== "components") return op;
    const was = baseValue(base, tokens);
    const shown = getAt(posed, tokens);
    if (was === undefined || shown === undefined || jsonEqual(was, shown)) return op;
    return { ...op, value: unposeValue(was, shown, op.value, tokens) as SetOp["value"] };
  });
}
