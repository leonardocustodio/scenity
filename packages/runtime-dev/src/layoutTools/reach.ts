// SPDX-License-Identifier: Apache-2.0
/**
 * The reach tool: the sphere of the arm reach of an actor and the `reach` metric to a work point. The actor is an
 * entity with a `character` component or a `standPoint` component.
 *
 * - **A character with arm bones**: the sphere has its middle at the upper arm bone (the shoulder) and the length of
 *   the arm bones (upper arm, lower arm, hand) as its radius. The metric measures in space from the shoulder.
 * - **A stand point, or a character with no arm bones**: the sphere has its middle above the entity at
 *   REACH_DEFAULTS.shoulder and the radius REACH_DEFAULTS.arm. The metric measures over the floor from the entity,
 *   as in a top view of a room.
 * - **The side**: the request, else the side whose hand is nearer the target, else the right side.
 *
 * The defaults are provisional values of an adult: a project gives its own values in the request.
 */
import type { CharacterValue } from "@scenity/scene/components";
import { pointDistance, type MetricContext, type PointArg, type Vec3 } from "@scenity/rules";
import {
  emptyShapes,
  entityRef,
  lengthText,
  noInput,
  pointWords,
  refEntity,
  ring,
  runMetric,
  type LayoutToolResult,
  type ReachRequest,
  type Shapes,
} from "./shared";

/** The provisional reach of an actor with no arm bones (m): the arm length and the shoulder height of an adult. */
export const REACH_DEFAULTS = { arm: 0.75, shoulder: 1.4 } as const;

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

/** The reach of an actor: the middle and the radius of its sphere, and the `from` and the plane of the metric. */
interface ReachFrame {
  readonly center: Vec3;
  readonly arm: number;
  readonly from: PointArg;
  readonly plane: "space" | "floor";
  readonly words: string;
}

/** True when the entity can reach: a `character` or a `standPoint` component. */
function canReach(ctx: MetricContext, id: string): boolean {
  const components = ctx.entity(id)?.components ?? [];
  return components.includes("character") || components.includes("standPoint");
}

/** The point of a bone of an entity: the canonical name, else the node name of the `character` component. */
function bone(ctx: MetricContext, id: string, name: string): Vec3 | null {
  const joints = ctx.entity(id)?.joints ?? null;
  if (joints === null) return null;
  const node = (ctx.scene?.entities[id]?.components.character as CharacterValue | undefined)?.bones?.[name];
  return joints[name] ?? (node === undefined ? undefined : joints[node]) ?? null;
}

/** The arm bones of a side: the shoulder, the elbow and the hand, or null when one is missing. */
function armOf(ctx: MetricContext, id: string, side: "left" | "right"): [Vec3, Vec3, Vec3] | null {
  const parts = [`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`].map((name) => bone(ctx, id, name));
  const [shoulder, elbow, hand] = parts;
  if (shoulder == null || elbow == null || hand == null) return null;
  return [shoulder, elbow, hand];
}

/** The side of the arm: the request, else the hand nearer the target, else the right side. */
function sideOf(ctx: MetricContext, id: string, request: ReachRequest, target: Vec3 | null): "left" | "right" {
  if (request.side !== undefined) return request.side;
  const left = armOf(ctx, id, "left");
  const right = armOf(ctx, id, "right");
  if (target === null || left === null || right === null) return right === null && left !== null ? "left" : "right";
  return pointDistance(left[2], target) < pointDistance(right[2], target) ? "left" : "right";
}

/** The reach frame of an actor, or null when the actor has no place. */
function frameOf(ctx: MetricContext, id: string, request: ReachRequest, target: Vec3 | null): ReachFrame | null {
  const side = sideOf(ctx, id, request, target);
  const arm = armOf(ctx, id, side);
  if (arm !== null) {
    const length = pointDistance(arm[0], arm[1]) + pointDistance(arm[1], arm[2]);
    const radius = request.arm ?? length;
    const words = `the ${side} arm: ${lengthText(radius)} from the shoulder${request.arm === undefined ? "" : " (given)"}`;
    return { center: arm[0], arm: radius, from: `${entityRef(id)}#${side}UpperArm`, plane: "space", words };
  }
  const origin = ctx.point(entityRef(id));
  if (origin === null) return null;
  const radius = request.arm ?? REACH_DEFAULTS.arm;
  const center: Vec3 = [origin[0], origin[1] + REACH_DEFAULTS.shoulder, origin[2]];
  const words = `${lengthText(radius)} over the floor from the stand place (${request.arm === undefined ? "provisional" : "given"})`;
  return { center, arm: radius, from: entityRef(id), plane: "floor", words };
}

/** The wire sphere: three great circles, the floor ring and the post to the floor. */
function sphereShapes(shapes: Shapes, frame: ReachFrame, label: string): void {
  const { center, arm } = frame;
  for (const [u, v] of [
    [X, Z],
    [X, Y],
    [Z, Y],
  ] as const) {
    shapes.lines.push({ points: ring(center, arm, u, v), tone: "reach", closed: true });
  }
  const foot: Vec3 = [center[0], 0.01, center[2]];
  shapes.lines.push({ points: ring(foot, arm, X, Z), tone: "part", closed: true });
  shapes.lines.push({ points: [foot, center], tone: "reach" });
  shapes.labels.push({ at: [center[0], center[1] + arm, center[2]], text: label, tone: "reach" });
}

/** The actor of a request: the entity of the request, else the first selected entity that can reach. */
function actorOf(ctx: MetricContext, request: ReachRequest): string | null {
  if (request.entity !== undefined) return request.entity;
  return (request.selection ?? []).find((id) => canReach(ctx, id)) ?? null;
}

export function reachTool(ctx: MetricContext, request: ReachRequest): LayoutToolResult {
  const actor = actorOf(ctx, request);
  if (actor === null) {
    return noInput("reach", "Reach needs an entity with a character component or a stand point: select one.");
  }
  if (!canReach(ctx, actor)) return noInput("reach", `${actor} has no character component and no stand point.`);
  const other = (request.selection ?? []).find((id) => id !== actor);
  const target = request.target ?? (other === undefined ? null : entityRef(other));
  const targetPoint = target === null ? null : ctx.point(target);
  const frame = frameOf(ctx, actor, request, targetPoint);
  if (frame === null) return noInput("reach", `${actor} has no place in the scene.`);
  const shapes = emptyShapes();
  sphereShapes(shapes, frame, `${actor} reach ${lengthText(frame.arm)}`);
  const lines = [`${actor}: ${frame.words}`];
  if (target === null || targetPoint === null) {
    lines.push(target === null ? "No target: select a second entity." : `No point for ${pointWords(target)}.`);
    return { tool: "reach", ok: true, reason: null, subjects: [actor], metrics: [], lines, overlay: shapes };
  }
  const args = { entity: actor, target, arm: frame.arm, from: frame.from, plane: frame.plane };
  const run = runMetric(ctx, "reach", args);
  const spare = run.result?.value ?? null;
  const tone = spare !== null && spare >= 0 ? "reach" : "blocked";
  shapes.lines.push({ points: [frame.center, targetPoint], tone });
  shapes.dots.push({ at: targetPoint, tone });
  const verdict =
    spare === null
      ? "no value"
      : spare >= 0
        ? `in reach: ${lengthText(spare)} to spare`
        : `out of reach by ${lengthText(-spare)}`;
  shapes.labels.push({ at: targetPoint, text: verdict, tone });
  lines.push(`${pointWords(target)}: ${verdict}`);
  const subjects = [actor, refEntity(target)].filter((id): id is string => id !== null);
  return { tool: "reach", ok: true, reason: null, subjects, metrics: [run], lines, overlay: shapes };
}
