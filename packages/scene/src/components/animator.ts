// SPDX-License-Identifier: Apache-2.0
/**
 * The `animator` component: a controller of clip layers and the values of its parameters. The animator mixes the pose
 * layers. A layer is a small state machine. Its states play a motion (a clip, a 1D blend of clips or a procedural
 * motion of a plugin). Its transitions go from one state to another on parameter conditions and exit times, with a
 * crossfade. `@scenity/character/animator` evaluates the controller at a time, and the runtime poses the skinned model
 * of the same entity. A sequence changes a parameter with a property track on
 * `animator/parameters/<name>`.
 */
import { z } from "zod";
import { assetRefSchema, SUB_PATTERN } from "../schema/common";
import { defineComponent } from "./define";

/** The pattern of a parameter, state, layer and event name. */
export const ANIMATOR_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The `from` value of a transition that applies in each state of the layer. */
export const ANY_STATE = "*";
/** The default crossfade of a transition in ms. */
export const DEFAULT_FADE_MS = 200;
/** The default time between two checks of the transitions in ms. */
export const DEFAULT_STEP_MS = 50;

const nameSchema = z.string().regex(ANIMATOR_NAME_PATTERN, "a name has 1 to 64 letters, digits, '_', '.', ':' or '-'");
/** The name of a clip in the model asset (a glTF animation name). */
const clipSchema = z.string().min(1).max(128);
const boneSchema = z.string().regex(SUB_PATTERN, "not a bone name");
const msSchema = z.number().int().min(0);
const valueSchema = z.union([z.number(), z.boolean()]);

/** A parameter of the controller: its type and its default value. */
export const animatorParameterSchema = z.union([
  z.strictObject({ type: z.literal("number"), default: z.number() }),
  z.strictObject({ type: z.literal("bool"), default: z.boolean() }),
]);

export const CONDITION_OPS = ["eq", "ne", "gt", "ge", "lt", "le"] as const;
/** A condition of a transition: the parameter value compared with `value`. */
export const animatorConditionSchema = z.strictObject({
  parameter: nameSchema,
  op: z.enum(CONDITION_OPS),
  value: valueSchema,
});

/** One point of a 1D blend: the clip has the full weight at the parameter value `at`. */
export const blendPointSchema = z.strictObject({
  at: z.number(),
  clip: clipSchema,
  /** The play speed of this clip in the blend (default 1). */
  speed: z.number().gt(0).optional(),
});

/** What a state plays. The clips of a 1D blend keep the same normalized time (a walk and a run stay in step). */
export const animatorMotionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clip"), clip: clipSchema }),
  z.strictObject({ kind: z.literal("blend1d"), parameter: nameSchema, points: z.array(blendPointSchema).min(1) }),
  /** A procedural motion of a plugin (`<plugin>.<name>`) with its cycle length in seconds. */
  z.strictObject({
    kind: z.literal("procedural"),
    id: z.string().regex(/^[a-z][A-Za-z0-9-]{0,63}\.[A-Za-z0-9_.:-]{1,64}$/, "a procedural motion is <plugin>.<name>"),
    duration: z.number().gt(0),
  }),
]);

/** An event at a normalized time of the motion of a state (0: the start, 1: the end). A loop gives it each cycle. */
export const animatorEventSchema = z.strictObject({ at: z.number().min(0).max(1), name: nameSchema });

export const animatorStateSchema = z.strictObject({
  motion: animatorMotionSchema,
  /** The play speed (default 1). */
  speed: z.number().min(0).optional(),
  /** A number parameter that multiplies the speed. */
  speedParameter: nameSchema.optional(),
  /** True (the default): the motion starts again at its end. False: it holds its last pose. */
  loop: z.boolean().optional(),
  events: z.array(animatorEventSchema).optional(),
});

export const animatorTransitionSchema = z.strictObject({
  /** The source state, or "*" for each state of the layer except the target. */
  from: z.union([z.literal(ANY_STATE), nameSchema]),
  to: nameSchema,
  /** Each condition must hold. */
  when: z.array(animatorConditionSchema).optional(),
  /** The normalized time of the source state (1: one cycle) before the transition can go. */
  exitTime: z.number().min(0).optional(),
  /** The crossfade in ms (default 200). */
  duration: msSchema.optional(),
});

export const ANIMATOR_BLENDS = ["override", "additive"] as const;
export const animatorLayerSchema = z.strictObject({
  name: nameSchema,
  /** The weight of the layer over the layers before it (default 1). */
  weight: z.number().min(0).max(1).optional(),
  /** "override" (the default) mixes the pose by the weight; "additive" adds the motion away from time 0 of a clip. */
  blend: z.enum(ANIMATOR_BLENDS).optional(),
  /** The bones that the layer controls, each with its children. No mask: all bones. */
  mask: z.array(boneSchema).optional(),
  /** The state at time 0. */
  start: nameSchema,
  states: z.record(nameSchema, animatorStateSchema),
  /** The transitions in order of priority: the first transition that can go, goes. */
  transitions: z.array(animatorTransitionSchema).optional(),
});

/** The parameters, the layers and the check step of the state machines. */
export const animatorControllerSchema = z.strictObject({
  parameters: z.record(nameSchema, animatorParameterSchema).optional(),
  layers: z.array(animatorLayerSchema).min(1),
  /** The time between two checks of the transitions in ms (a parameter key and an exit time are also checks). */
  stepMs: z.number().int().min(1).max(1000).optional(),
});

export const ROOT_MOTIONS = ["in-place", "clip"] as const;

/** One leg of the foot lock: a two-bone chain, and a node outside the chain that moves with its end. */
export const footLockLegSchema = z.strictObject({
  upper: boneSchema,
  lower: boneSchema,
  /** The node at the end of the chain (the ankle): the lock keeps it at its place on the floor. */
  end: boneSchema,
  /** A node outside the chain that follows the end (the foot control bone of some rigs). */
  follow: boneSchema.optional(),
});

/** The foot lock: a foot in contact with the floor stays at the place where the contact started. */
export const footLockSchema = z.strictObject({
  legs: z.array(footLockLegSchema).min(1),
  /** A foot is in contact when its height is in the lowest share of its range in the clip (default 0.2). */
  contact: z.number().gt(0).max(1).optional(),
  /** The share of a contact at each end where the lock fades in and out (default 0.15). */
  fade: z.number().min(0).max(0.5).optional(),
});

function checkLayer(
  layer: z.output<typeof animatorLayerSchema>,
  index: number,
  parameters: Readonly<Record<string, z.output<typeof animatorParameterSchema>>>,
  ctx: z.RefinementCtx,
): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path: ["controller", "layers", index, ...path], message });
  const isNumber = (name: string) => parameters[name]?.type === "number";
  if (!Object.hasOwn(layer.states, layer.start)) issue(["start"], `the layer has no state "${layer.start}"`);
  for (const [name, state] of Object.entries(layer.states)) {
    if (state.speedParameter !== undefined && !isNumber(state.speedParameter))
      issue(["states", name, "speedParameter"], `"${state.speedParameter}" is not a number parameter`);
    const motion = state.motion;
    if (motion.kind !== "blend1d") continue;
    if (!isNumber(motion.parameter))
      issue(["states", name, "motion", "parameter"], `"${motion.parameter}" is not a number parameter`);
    motion.points.forEach((point, at) => {
      const before = motion.points[at - 1];
      if (before !== undefined && point.at <= before.at)
        issue(["states", name, "motion", "points", at, "at"], "the points of a blend are in increasing order");
    });
  }
  (layer.transitions ?? []).forEach((transition, at) => {
    if (transition.from !== ANY_STATE && !Object.hasOwn(layer.states, transition.from))
      issue(["transitions", at, "from"], `the layer has no state "${transition.from}"`);
    if (!Object.hasOwn(layer.states, transition.to))
      issue(["transitions", at, "to"], `the layer has no state "${transition.to}"`);
    (transition.when ?? []).forEach((condition, item) => {
      const parameter = parameters[condition.parameter];
      if (parameter === undefined)
        issue(["transitions", at, "when", item, "parameter"], `no parameter "${condition.parameter}"`);
      else if ((parameter.type === "bool") !== (typeof condition.value === "boolean"))
        issue(["transitions", at, "when", item, "value"], `the value does not match the ${parameter.type} parameter`);
    });
  });
}

const animatorObject = z.strictObject({
  controller: animatorControllerSchema,
  /** The parameter values that differ from the defaults of the controller. A sequence keys them over time. */
  parameters: z.record(nameSchema, valueSchema).optional(),
  /** The speed of all layers (default 1). */
  speed: z.number().min(0).optional(),
  /** The root bone of the skeleton (default: the first bone of the skin). */
  rootBone: boneSchema.optional(),
  /** "in-place" (the default) keeps the root bone over its rest place on the floor; "clip" keeps the clip motion. */
  rootMotion: z.enum(ROOT_MOTIONS).optional(),
  footLock: footLockSchema.optional(),
  /**
   * The clips of another model asset: the runtime retargets them through the rig profiles when it
   * loads them. `rig` is the profile of that skeleton (default: the profile from its bone names). The clip names of
   * the controller are then the clip names of that asset.
   */
  clipSource: z.strictObject({ asset: assetRefSchema, rig: z.string().min(1).max(64).optional() }).optional(),
});

/** The checks over more than one field: the names of states and parameters exist and have the right type. */
function checkAnimator(value: z.output<typeof animatorObject>, ctx: z.RefinementCtx): void {
  const parameters = value.controller.parameters ?? {};
  value.controller.layers.forEach((layer, index) => checkLayer(layer, index, parameters, ctx));
  for (const [name, item] of Object.entries(value.parameters ?? {})) {
    const declared = parameters[name];
    if (declared === undefined) ctx.addIssue({ code: "custom", path: ["parameters", name], message: "no parameter" });
    else if ((declared.type === "bool") !== (typeof item === "boolean"))
      ctx.addIssue({ code: "custom", path: ["parameters", name], message: `not a ${declared.type} value` });
  }
}

export const animatorSchema = animatorObject.superRefine(checkAnimator);
export type AnimatorValue = z.infer<typeof animatorSchema>;
export type AnimatorController = AnimatorValue["controller"];
export type AnimatorLayer = z.infer<typeof animatorLayerSchema>;
export type AnimatorState = z.infer<typeof animatorStateSchema>;
export type AnimatorTransition = z.infer<typeof animatorTransitionSchema>;
export type AnimatorCondition = z.infer<typeof animatorConditionSchema>;
export type AnimatorMotion = z.infer<typeof animatorMotionSchema>;
export type AnimatorParameter = z.infer<typeof animatorParameterSchema>;
export type FootLockValue = z.infer<typeof footLockSchema>;
export type FootLockLeg = z.infer<typeof footLockLegSchema>;
export type RootMotion = (typeof ROOT_MOTIONS)[number];
export type ClipSourceValue = NonNullable<AnimatorValue["clipSource"]>;

/** The animator of a skinned model on the same entity. */
export const animatorComponent = defineComponent({
  id: "animator",
  schema: animatorSchema,
  defaults: { parameters: {}, speed: 1, rootMotion: "in-place" },
  editor: {
    label: "Animator",
    group: "Animation",
    fields: {
      controller: { widget: { kind: "custom", name: "animatorController" }, label: "Controller" },
      parameters: { widget: { kind: "custom", name: "animatorParameters" }, label: "Parameters" },
      speed: { widget: { kind: "number", min: 0, step: 0.05 }, label: "Speed" },
      rootBone: { widget: { kind: "string" }, label: "Root bone", group: "Root motion" },
      rootMotion: { widget: { kind: "enum", options: ROOT_MOTIONS }, label: "Root motion", group: "Root motion" },
      footLock: { widget: { kind: "custom", name: "footLock" }, label: "Foot lock" },
      clipSource: { widget: { kind: "custom", name: "clipSource" }, label: "Clip source" },
    },
  },
});
