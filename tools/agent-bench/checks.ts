// SPDX-License-Identifier: Apache-2.0
/**
 * The helpers of the checks of the agent benchmark: entities, world places, colours and the `scenity check` of a
 * project. A check reads the documents after the run. It never reads the transcript of the agent, except for a case
 * that asks for an answer in text.
 */
import { spawnSync } from "node:child_process";
import { SCENITY, type BenchProject, type Entity, type Json, type Quat, type SceneDoc, type Vec3 } from "./project";

/** The result of a check: pass or fail, and a short reason. */
export interface CheckResult {
  readonly pass: boolean;
  readonly detail: string;
}

export function pass(detail: string): CheckResult {
  return { pass: true, detail };
}

export function fail(detail: string): CheckResult {
  return { pass: false, detail };
}

/** All the results must pass. The detail is that of the first failure, else of the last result. */
export function all(...results: CheckResult[]): CheckResult {
  return results.find((result) => !result.pass) ?? results.at(-1) ?? pass("no check");
}

export function component<T = Json>(entity: Entity | undefined, id: string): T | undefined {
  return entity?.components[id] as T | undefined;
}

/** The IDs of the entities of `after` that are not in `before`. */
export function newEntities(before: SceneDoc, after: SceneDoc): string[] {
  return Object.keys(after.entities).filter((id) => before.entities[id] === undefined);
}

/** The entities whose name matches `pattern`. */
export function named(scene: SceneDoc, pattern: RegExp): [string, Entity][] {
  return Object.entries(scene.entities).filter(([, entity]) => pattern.test(entity.name ?? ""));
}

/** The entities with the component `id`. */
export function withComponent(scene: SceneDoc, id: string): [string, Entity][] {
  return Object.entries(scene.entities).filter(([, entity]) => entity.components[id] !== undefined);
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

interface Transform {
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly scale?: Vec3;
}

/** The world position of an entity: its transform and the transforms of its parents. */
export function worldPosition(scene: SceneDoc, id: string): Vec3 {
  let point: Vec3 = [0, 0, 0];
  for (let at: string | null = id; at !== null;) {
    const entity: Entity | undefined = scene.entities[at];
    if (entity === undefined) break;
    const t = component<Transform>(entity, "transform") ?? {};
    const s = t.scale ?? [1, 1, 1];
    const scaled: Vec3 = [point[0] * s[0], point[1] * s[1], point[2] * s[2]];
    const turned = rotate(t.rotation ?? [0, 0, 0, 1], scaled);
    const p = t.position ?? [0, 0, 0];
    point = [turned[0] + p[0], turned[1] + p[1], turned[2] + p[2]];
    at = entity.parent;
  }
  return point;
}

/** The distance of two points on the floor plane (x and z). */
export function floorDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The red, green and blue parts (0 to 1) of a `#rrggbb` colour. */
export function rgb(hex: string): Vec3 {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16) / 255) as Vec3;
}

/** The relative luminance of a colour (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as Vec3;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How warm a colour is: red minus blue. */
export function warmth(hex: string): number {
  const [r, , b] = rgb(hex);
  return r - b;
}

/** The angle of a point around a centre on the floor plane, in degrees from 0 to 360. */
export function floorAngle(centre: Vec3, point: Vec3): number {
  const angle = (Math.atan2(point[2] - centre[2], point[0] - centre[0]) * 180) / Math.PI;
  return (angle + 360) % 360;
}

/** The largest gap between the angles, in degrees. Four points around a centre have gaps under 150. */
export function largestGap(angles: readonly number[]): number {
  const sorted = [...angles].sort((a, b) => a - b);
  let gap = 360 - (sorted.at(-1) ?? 0) + (sorted[0] ?? 0);
  for (let i = 1; i < sorted.length; i += 1) gap = Math.max(gap, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
  return gap;
}

/** `scenity check` of the project: pass when the exit code is 0. */
export function scenityCheck(project: BenchProject): CheckResult {
  const run = spawnSync(SCENITY[0] ?? "bun", [...SCENITY.slice(1), "check", project.dir], { encoding: "utf8" });
  return run.status === 0 ? pass("scenity check passes") : fail(`scenity check fails: ${run.stdout.slice(-300)}`);
}

/** Run a Bun script in the project folder (the plugin imports resolve there). Pass when it exits with 0. */
export function bunScript(project: BenchProject, code: string): CheckResult {
  const run = spawnSync("bun", ["-e", code], { cwd: project.dir, encoding: "utf8" });
  return run.status === 0
    ? pass(run.stdout.trim() || "the script passes")
    : fail((run.stderr || run.stdout).slice(-400));
}
