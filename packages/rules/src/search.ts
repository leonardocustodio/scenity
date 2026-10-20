// SPDX-License-Identifier: Apache-2.0
/**
 * The generic layout search: a seeded search over chosen op paths of a scene that keeps the layouts with the best rule
 * margins. The layout variants of a plugin are a configuration of it.
 *
 * 1. **Samples**: `steps` candidates. A candidate moves one or two groups (one in half of the candidates). Each
 *    moved group gets new values from `propose` (default: a uniform value in the bounds of each op, on its grid).
 * 2. **Check**: `settle` puts each moved group in its bounds (or puts the candidate out). The writes of the groups
 *    and of `follow` become scene ops (`set` ops) on the scene. The rules are evaluated on the new scene, and
 *    the objective gives the score from the rule margins and the move cost (searchObjective.ts).
 * 3. **Variants**: the best candidates, each at least `minApart` from the current scene and from each other variant.
 *    The distance of two layouts is the largest distance of one group between them. `rounds` of a refine then try
 *    for each moved group the half way back to the start and a nudge of each op.
 *
 * **Determinism**: the named stream `<stream>:<seed>` (random.ts) gives every random number, and the search makes a
 * fixed count of candidates. The same inputs and seed give the same variants. The time budget only stops a search
 * that runs too long: the result then says `complete: false`.
 */
import type { Rule } from "@scenity/scene";
import { builtinRegistry, type ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SetOp } from "@scenity/scene/schema/entity";
import type { MetricContext } from "./context";
import { evaluateRules, type RuleResult } from "./gate";
import { seededStream, streamName } from "./random";
import type { MetricRegistry } from "./registry";
import type { RuleSequence, RuleTime } from "./scopes";
import { marginObjective, type SearchObjective } from "./searchObjective";
import {
  groupWrites,
  onGrid,
  searchGroups,
  writeOps,
  type SearchGroup,
  type SearchOp,
  type SearchWrite,
} from "./searchOps";

/** The values of the moved groups of a candidate, by group, in the order of the moves. */
export type GroupValues = ReadonlyMap<string, readonly number[]>;

/** The hooks of a search. Each hook has a generic default. */
export interface SearchHooks {
  /** New values of a group. Default: a uniform change in [min, max] of each op, on the grid of its step. */
  readonly propose?: (group: SearchGroup, random: () => number) => readonly number[];
  /** The values in the bounds (a snap can move them), or null when they are out. Default: out of [min, max]. */
  readonly settle?: (group: SearchGroup, values: readonly number[]) => readonly number[] | null;
  /** The writes that follow the moved groups (an item that sits on a moved group). Default: none. */
  readonly follow?: (moved: GroupValues) => readonly SearchWrite[];
  /** The distance of a group between two values. Default: the length of the number changes plus the yaw changes. */
  readonly distance?: (group: SearchGroup, a: readonly number[], b: readonly number[]) => number;
}

export interface SearchLayoutOptions<D extends EntityDocument> extends SearchHooks {
  readonly scene: D;
  readonly ops: readonly SearchOp[];
  readonly rules: readonly Rule[];
  readonly registry: MetricRegistry;
  /** The metric context of a candidate scene at a time of a rule, or null. */
  readonly contextAt: (scene: D, at: RuleTime) => MetricContext | null;
  /** The sequences of the rules with a sequence scope. */
  readonly sequences?: Readonly<Record<string, RuleSequence>>;
  /** The schemas that check the ops (default: the built-in components of the engine). */
  readonly components?: ComponentRegistry;
  readonly seed?: number;
  /** The name of the random stream (default `layout-search`). */
  readonly stream?: string;
  /** The count of candidates of the samples (default 240). */
  readonly steps?: number;
  /** The rounds of the refine (default 2). */
  readonly rounds?: number;
  /** The most variants (default 4). */
  readonly count?: number;
  /** The least distance between two variants, and from the current scene (default 0.15). */
  readonly minApart?: number;
  /** The score of a candidate (default `marginObjective()`). */
  readonly objective?: SearchObjective;
  /** The time budget (ms; default: no limit), and its clock (default `performance.now`). */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

/** A variant of the search: a layout that passes the objective. */
export interface SearchVariant<D extends EntityDocument> {
  /** `v1` to `vN`, the best first. */
  readonly id: string;
  readonly values: GroupValues;
  readonly writes: readonly SearchWrite[];
  /** The scene ops from the current scene to the variant. */
  readonly ops: readonly SetOp[];
  readonly scene: D;
  readonly results: readonly RuleResult[];
  readonly move: number;
  readonly score: number;
}

export interface SearchResult<D extends EntityDocument> {
  readonly seed: number;
  /** The groups of the ops, in their order. */
  readonly groups: readonly string[];
  readonly variants: readonly SearchVariant<D>[];
  /** The candidates of the samples, and those that the objective kept. */
  readonly checked: number;
  readonly passed: number;
  readonly ms: number;
  /** False when the time budget stopped the search. */
  readonly complete: boolean;
  readonly notes: readonly string[];
}

type Candidate<D extends EntityDocument> = Omit<SearchVariant<D>, "id">;

/** The default distance: the length of the weighted number changes plus the weighted yaw changes. */
function defaultDistance(group: SearchGroup, a: readonly number[], b: readonly number[]): number {
  const lengths: number[] = [];
  let turn = 0;
  group.ops.forEach((op, index) => {
    const change = (b[index] ?? 0) - (a[index] ?? 0);
    if (op.kind === "yaw") turn += (op.weight ?? 1) * Math.abs(change);
    else lengths.push((op.weight ?? 1) * change);
  });
  return Math.hypot(...lengths) + turn;
}

function defaultPropose(group: SearchGroup, random: () => number): number[] {
  return group.ops.map((op, index) => {
    const start = group.start[index] ?? 0;
    return onGrid(start + op.min + random() * (op.max - op.min), op.step);
  });
}

function defaultSettle(group: SearchGroup, values: readonly number[]): readonly number[] | null {
  const inside = group.ops.every((op, index) => {
    const change = (values[index] ?? 0) - (group.start[index] ?? 0);
    return change >= op.min - 1e-9 && change <= op.max + 1e-9;
  });
  return inside ? values : null;
}

/** The parts of one search that the steps share. */
interface Search<D extends EntityDocument> {
  readonly options: SearchLayoutOptions<D>;
  readonly groups: ReadonlyMap<string, SearchGroup>;
  readonly components: ComponentRegistry;
  readonly objective: SearchObjective;
  readonly distance: NonNullable<SearchHooks["distance"]>;
  readonly settle: NonNullable<SearchHooks["settle"]>;
}

/** Check a candidate: null when a group is out of its bounds, an op is refused or the objective puts it out. */
function check<D extends EntityDocument>(search: Search<D>, raw: GroupValues): Candidate<D> | null {
  const values = new Map<string, readonly number[]>();
  const writes: SearchWrite[] = [];
  for (const [id, proposed] of raw) {
    const group = search.groups.get(id);
    const settled = group === undefined ? null : search.settle(group, proposed);
    if (group === undefined || settled === null) return null;
    values.set(id, settled);
    writes.push(...groupWrites(group, settled));
  }
  writes.push(...(search.options.follow?.(values) ?? []));
  const ops = writeOps(writes);
  const applied = applyOps(search.options.scene, ops, search.components);
  if (!applied.ok) return null;
  const { rules, registry, contextAt, sequences } = search.options;
  const scene = applied.doc;
  const results = evaluateRules(rules, registry, (at) => contextAt(scene, at), sequences ? { sequences } : {});
  let move = 0;
  for (const [id, settled] of values) {
    const group = search.groups.get(id);
    if (group !== undefined) move += search.distance(group, group.start, settled);
  }
  const score = search.objective({ rules, results, move });
  return score === null ? null : { values, writes, ops, scene, results, move, score };
}

/** The largest distance of one group between two sets of values (a group that a set does not move is at its start). */
function apart<D extends EntityDocument>(search: Search<D>, a: GroupValues, b: GroupValues): number {
  let most = 0;
  for (const group of search.groups.values()) {
    most = Math.max(most, search.distance(group, a.get(group.id) ?? group.start, b.get(group.id) ?? group.start));
  }
  return most;
}

/** The best candidates that are apart from the current scene and from each other, in the order of their scores. */
function distinct<D extends EntityDocument>(
  search: Search<D>,
  pool: readonly Candidate<D>[],
  count: number,
  minApart: number,
): Candidate<D>[] {
  const kept: Candidate<D>[] = [];
  for (const candidate of [...pool].sort((a, b) => a.score - b.score)) {
    if (kept.length >= count) break;
    if (apart(search, candidate.values, new Map()) < minApart) continue;
    if (kept.some((other) => apart(search, candidate.values, other.values) < minApart)) continue;
    kept.push(candidate);
  }
  return kept;
}

/** The refine of a candidate: each moved group tries the half way back to its start, then ± the nudge of each op. */
function refine<D extends EntityDocument>(search: Search<D>, start: Candidate<D>): Candidate<D> {
  let best = start;
  for (const id of start.values.keys()) {
    const group = search.groups.get(id);
    const values = best.values.get(id);
    if (group === undefined || values === undefined) continue;
    const tries: number[][] = [
      values.map((value, index) => {
        const op = group.ops[index];
        return op?.nudge === undefined ? value : (value + (group.start[index] ?? 0)) / 2;
      }),
    ];
    group.ops.forEach((op, index) => {
      if (op.nudge === undefined) return;
      for (const sign of [1, -1])
        tries.push(values.map((value, at) => (at === index ? value + sign * (op.nudge ?? 0) : value)));
    });
    for (const next of tries) {
      const grid = next.map((value, index) => {
        const op = group.ops[index];
        return op?.nudge === undefined ? value : onGrid(value, op.step);
      });
      const made = check(search, new Map([...best.values, [id, grid]]));
      if (made !== null && made.score < best.score - 1e-9) best = made;
    }
  }
  return best;
}

/** Search layouts over the op paths of a scene that the objective keeps (see the head of this file). */
export function searchLayout<D extends EntityDocument>(options: SearchLayoutOptions<D>): SearchResult<D> {
  const clock = options.now ?? (() => performance.now());
  const started = clock();
  const { seed = 1, steps = 240, rounds = 2, count = 4, minApart = 0.15 } = options;
  const budget = options.budgetMs ?? Number.POSITIVE_INFINITY;
  const random = seededStream(streamName(options.stream ?? "layout-search", seed));
  const list = searchGroups(options.scene, options.ops);
  const search: Search<D> = {
    options,
    groups: new Map(list.map((group) => [group.id, group])),
    components: options.components ?? builtinRegistry(),
    objective: options.objective ?? marginObjective(),
    distance: options.distance ?? defaultDistance,
    settle: options.settle ?? defaultSettle,
  };
  const propose = options.propose ?? defaultPropose;
  const pool: Candidate<D>[] = [];
  let checked = 0;
  let complete = true;
  for (let sample = 0; sample < steps && list.length > 0; sample += 1) {
    if (clock() - started > budget) {
      complete = false;
      break;
    }
    const moved = new Map<string, readonly number[]>();
    const pick = random() < 0.5 ? 1 : Math.min(2, list.length);
    for (let index = 0; index < pick; index += 1) {
      const group = list[Math.floor(random() * list.length)] ?? list[0];
      if (group !== undefined) moved.set(group.id, propose(group, random));
    }
    checked += 1;
    const made = check(search, moved);
    if (made !== null) pool.push(made);
  }
  // The refine of the best distinct candidates, then the choice again (a refine can bring two together).
  let best = distinct(search, pool, count * 2, minApart);
  for (let round = 0; round < rounds && complete; round += 1) {
    if (clock() - started > budget) complete = false;
    else best = best.map((candidate) => refine(search, candidate));
  }
  const chosen = distinct(search, [...best, ...pool], count, minApart);
  const notes: string[] = [];
  if (chosen.length < count)
    notes.push(`The search found ${String(chosen.length)} distinct variants of ${String(count)}.`);
  if (!complete) notes.push(`The time budget of ${String(budget)} ms stopped the search: another run can give others.`);
  return {
    seed,
    groups: list.map((group) => group.id),
    variants: chosen.map((candidate, index) => ({ id: `v${String(index + 1)}`, ...candidate })),
    checked,
    passed: pool.length,
    ms: Math.round(clock() - started),
    complete,
    notes,
  };
}
