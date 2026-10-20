// SPDX-License-Identifier: Apache-2.0
/**
 * The metrics of a body: `ikError` of the IK goals, `jointAngle` of a bone chain, and `reach` from an actor
 * to a work point with an arm length.
 *
 * | Metric | Value |
 * | --- | --- |
 * | `ikError` | The largest distance from the end bone of an IK goal to its target (m) |
 * | `jointAngle` | The smallest angle at the middle joint of a chain (degrees; 180 is straight) |
 * | `reach` | The arm length minus the distance from the actor to the target (m; under 0 is out of reach) |
 */
import { z } from "zod";
import type { MetricContext } from "../context";
import { distance, floorDistance, jointAngle as angleAt } from "../geometry";
import { defineMetric } from "../registry";
import type { MetricItem, Vec3 } from "../types";
import { cm, fromItems, notApplied, pointArg, selectorArg } from "./common";

/** The entities of a selector, or by default the entities with joints. */
function bodies(ctx: MetricContext, selector: string | readonly string[] | undefined): string[] {
  if (selector !== undefined) return ctx.select(selector);
  return ctx.entities().flatMap((entity) => (entity.joints === null ? [] : [entity.id]));
}

export const ikError = defineMetric({
  id: "ikError",
  label: "IK error",
  unit: "m",
  worst: "max",
  args: z.strictObject({
    /** The entities. Default: each entity with joints. */
    entity: selectorArg.optional(),
    /** One goal (`leftHand`, `rightHand`). Default: each hand goal. */
    goal: z.string().min(1).optional(),
    /** Only goals with a weight over this count. */
    minWeight: z.number().min(0).max(1).default(0),
  }),
  evaluate(ctx, args) {
    const items: MetricItem[] = [];
    for (const id of bodies(ctx, args.entity)) {
      for (const goal of ctx.ikGoals(id)) {
        if (args.goal !== undefined && goal.goal !== args.goal) continue;
        if (goal.weight <= args.minWeight || goal.target === null || goal.end === null) continue;
        const value = distance(goal.target, goal.end);
        items.push({ subject: `${id}#${goal.goal}`, value, detail: `${cm(value)} from the target` });
      }
    }
    return fromItems(items, "m", "max", "no IK goal with a target, an end bone and a weight");
  },
});

type Chain = readonly [string, string, string];

/** The chains of a limb: the canonical humanoid bones, and the joint names of the first plugin. */
const LIMBS: Readonly<Record<"elbow" | "knee", readonly Chain[]>> = {
  elbow: [
    ["leftUpperArm", "leftLowerArm", "leftHand"],
    ["rightUpperArm", "rightLowerArm", "rightHand"],
    ["shoulder_l", "elbow_l", "wrist_l"],
    ["shoulder_r", "elbow_r", "wrist_r"],
  ],
  knee: [
    ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
    ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
    ["hip_l", "knee_l", "ankle_l"],
    ["hip_r", "knee_r", "ankle_r"],
  ],
};

/** The smallest angle of the chains that the joints have, or null. */
function smallestAngle(joints: Readonly<Record<string, Vec3>>, chains: readonly Chain[]): number | null {
  let smallest: number | null = null;
  for (const [a, joint, b] of chains) {
    const pa = joints[a];
    const pj = joints[joint];
    const pb = joints[b];
    if (pa === undefined || pj === undefined || pb === undefined) continue;
    const angle = angleAt(pa, pj, pb);
    smallest = smallest === null ? angle : Math.min(smallest, angle);
  }
  return smallest;
}

export const jointAngle = defineMetric({
  id: "jointAngle",
  label: "Joint angle",
  unit: "deg",
  worst: "min",
  args: z
    .strictObject({
      /** The entities. Default: each entity with joints. */
      entity: selectorArg.optional(),
      /** Three joints: the angle is at the middle one. */
      chain: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]).optional(),
      /** The chains of both sides of a limb. */
      limb: z.enum(["elbow", "knee"]).optional(),
    })
    .refine((value) => (value.chain === undefined) !== (value.limb === undefined), "give a chain or a limb"),
  evaluate(ctx, args) {
    const chains: readonly Chain[] = args.chain === undefined ? LIMBS[args.limb ?? "elbow"] : [args.chain];
    const items: MetricItem[] = [];
    for (const id of bodies(ctx, args.entity)) {
      const joints = ctx.entity(id)?.joints ?? null;
      const angle = joints === null ? null : smallestAngle(joints, chains);
      if (angle !== null) items.push({ subject: id, value: angle, detail: `${angle.toFixed(1)}°` });
    }
    return fromItems(items, "deg", "min", "no entity with the joints of the chain");
  },
});

export const reach = defineMetric({
  id: "reach",
  label: "Reach",
  unit: "m",
  worst: "min",
  args: z.strictObject({
    /** The actor. */
    entity: z.string().min(1),
    /** The work point. */
    target: pointArg,
    /** The arm length (m). */
    arm: z.number().positive(),
    /** The point of the actor that reaches. Default: the origin of the actor (its stand place). */
    from: pointArg.optional(),
    /** `floor`: the distance over the floor (x, z), as in a top view of a room; `space`: in space (from a shoulder). */
    plane: z.enum(["floor", "space"]).default("floor"),
  }),
  evaluate(ctx, args) {
    const from = ctx.point(args.from ?? `entity:${args.entity}`);
    const target = ctx.point(args.target);
    if (from === null || target === null) return notApplied("m", `no place or no work point for ${args.entity}`);
    const far = args.plane === "floor" ? floorDistance(from, target) : distance(from, target);
    const spare = args.arm - far;
    const words = `${args.entity}: ${cm(far)} to the target, arm ${cm(args.arm)}`;
    return { value: spare, unit: "m", detail: spare >= 0 ? words : `${words}: ${cm(-spare)} out of reach` };
  },
});
