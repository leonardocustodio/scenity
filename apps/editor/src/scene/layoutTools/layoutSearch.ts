// SPDX-License-Identifier: Apache-2.0
/**
 * The layout search of the scene page: "find a place for this that
 * passes the rules". The search moves one entity over the floor (its position x and z, at most `radius` from where it
 * stands) with `searchLayout` of `@scenity/rules`, and scores each candidate on the scene rules of the page.
 *
 * A candidate gets its metric facts from the inspect report of the frame now: the moved entity and its subtree move
 * by the change of the position (their boxes, places, sockets and joints). So the search needs no render. A rule with
 * a sequence scope stays out (a candidate has no sequence time).
 */
import { createMetricRegistry, evaluateRules, searchLayout, type RuleResult, type SearchResult } from "@scenity/rules";
import type { ProjectDocument, Rule, SceneDocument } from "@scenity/scene";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { pageMetricContext } from "./layoutToolsState";

type Vec3 = readonly [number, number, number];

/** The position of an entity in a scene (its transform), or the origin. */
function positionOf(scene: SceneDocument, id: string): Vec3 {
  const transform = scene.entities[id]?.components.transform as { position?: readonly number[] } | undefined;
  const at = transform?.position ?? [0, 0, 0];
  return [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0];
}

/** The IDs of an entity and of its subtree in a scene. */
function subtreeOf(scene: SceneDocument, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, entity] of Object.entries(scene.entities)) {
      if (entity.parent !== null && out.has(entity.parent) && !out.has(child)) {
        out.add(child);
        grew = true;
      }
    }
  }
  return out;
}

const add = (point: Vec3, delta: Vec3): [number, number, number] => [
  point[0] + delta[0],
  point[1] + delta[1],
  point[2] + delta[2],
];

/** The report of a candidate: the subtree of the moved entity moves by its change of position. */
export function shiftedReport(
  report: SceneInspectReport,
  from: SceneDocument,
  to: SceneDocument,
  moved: string,
): SceneInspectReport {
  const a = positionOf(from, moved);
  const b = positionOf(to, moved);
  const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (delta.every((part) => part === 0)) return report;
  const ids = subtreeOf(to, moved);
  const box = (value: { readonly min: Vec3; readonly max: Vec3 } | null) =>
    value === null ? null : { ...value, min: add(value.min, delta), max: add(value.max, delta) };
  const points = (record: Readonly<Record<string, Vec3>>): Record<string, Vec3> =>
    Object.fromEntries(Object.entries(record).map(([key, point]) => [key, add(point, delta)]));
  return {
    ...report,
    entities: report.entities.map((entity) =>
      ids.has(entity.id)
        ? {
            ...entity,
            transform: { ...entity.transform, position: add(entity.transform.position, delta) },
            bounds: box(entity.bounds),
            ...(entity.ownBounds === undefined ? {} : { ownBounds: box(entity.ownBounds) }),
            sockets: points(entity.sockets),
            joints: entity.joints === null ? null : points(entity.joints),
          }
        : entity,
    ),
  };
}

/** The input of a search of the page. */
export interface PlaceSearch {
  readonly report: SceneInspectReport;
  /** The scene of the frame now (the scene of the report). */
  readonly scene: SceneDocument;
  readonly project: ProjectDocument | null;
  readonly rules: readonly Rule[];
  readonly entity: string;
  /** The largest move on x and on z (m, default 2). */
  readonly radius?: number;
  readonly seed?: number;
  readonly steps?: number;
}

/** The rules that a candidate scene can check: the rules with no sequence time. */
export function placeRules(rules: readonly Rule[]): Rule[] {
  return rules.filter(
    (rule) => rule.scope === undefined || rule.scope.kind === "scene" || rule.scope.kind === "entity",
  );
}

/** Search places for an entity; the variants are the best places first. */
export function searchPlaces(input: PlaceSearch): SearchResult<SceneDocument> {
  const radius = input.radius ?? 2;
  const path = `/entities/${input.entity}/components/transform/position`;
  const axis = (index: number) => ({
    path: `${path}/${String(index)}`,
    min: -radius,
    max: radius,
    step: 0.05,
    nudge: 0.05,
    group: input.entity,
  });
  return searchLayout({
    scene: input.scene,
    ops: [axis(0), axis(2)],
    rules: placeRules(input.rules),
    registry: createMetricRegistry(),
    contextAt: (scene) =>
      pageMetricContext(shiftedReport(input.report, input.scene, scene, input.entity), {
        posed: scene,
        base: scene,
        project: input.project,
      }),
    seed: input.seed ?? 1,
    ...(input.steps === undefined ? {} : { steps: input.steps }),
  });
}

/** The results of the rules of a search on the scene now (the start of the search). */
export function startResults(input: PlaceSearch): RuleResult[] {
  return evaluateRules(placeRules(input.rules), createMetricRegistry(), () =>
    pageMetricContext(input.report, { posed: input.scene, base: input.scene, project: input.project }),
  );
}

/** The scene op of a variant: the whole position of the entity (the core takes no op on one number of a list). */
export function placeOp(variant: { readonly scene: SceneDocument }, entity: string) {
  return {
    op: "set" as const,
    path: `/entities/${entity}/components/transform/position`,
    value: [...positionOf(variant.scene, entity)],
  };
}
