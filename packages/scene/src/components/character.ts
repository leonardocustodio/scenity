// SPDX-License-Identifier: Apache-2.0
/**
 * The `character` component: a skinned model of the same entity as a character. It gives the rig
 * profile of the skeleton, the bone names of a skeleton with no profile, the variants of the look, and the IK goals
 * of the hands and of the head.
 *
 * - A bone reference `entity:<id>#<bone>` names a canonical humanoid bone (`leftHand`, `head`: the bone names of
 *   VRM 1.0 in `@scenity/character/profiles`). The rig profile maps it to a node of the skeleton.
 * - An IK goal has a target (`entity:<id>` or `entity:<id>#<socket>`) and a weight from 0 to 1. A sequence keys
 *   them with property tracks, for example on `character/ik/rightHand/weight`.
 * - A variant is a set of material overrides by material name. `variant` names the active variant.
 */
import { z } from "zod";
import { entityRefSchema, SUB_PATTERN, vec3Schema } from "../schema/common";
import { defineComponent } from "./define";
import { materialOverrideSchema } from "./visual";

/** The pattern of a canonical bone name and of a variant name. */
export const CHARACTER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** The IK goals of a character: the two hands and the look of the head. */
export const CHARACTER_IK_GOALS = ["leftHand", "rightHand", "look"] as const;

const nameSchema = z.string().regex(CHARACTER_NAME_PATTERN, "a name starts with a letter (1 to 64 characters)");
const weightSchema = z.number().min(0).max(1);

/** The IK goal of a hand: the hand goes to the target by the weight, and the elbow bends toward the pole. */
export const handGoalSchema = z.strictObject({
  /** The target entity or socket. With no target, the goal has no effect. */
  target: entityRefSchema.nullable().optional(),
  weight: weightSchema.optional(),
  /** The direction of the elbow in the frame of the character (default: out to the side, down and a little back). */
  pole: vec3Schema.optional(),
});

/** The look goal: the head turns to the target by the weight, at most by `maxAngle` radians. */
export const lookGoalSchema = z.strictObject({
  target: entityRefSchema.nullable().optional(),
  weight: weightSchema.optional(),
  maxAngle: z.number().min(0).max(Math.PI).optional(),
});

export const characterSchema = z.strictObject({
  /**
   * The rig profile of the skeleton (`ue5`, `rigify`, `vrm`, `mixamo`), or `none`. With no value, the profile comes
   * from the bone names.
   */
  rig: z.string().min(1).max(64).optional(),
  /**
   * The node name of canonical bones: they complete the profile, or they give the map of a skeleton with no profile.
   */
  bones: z.record(nameSchema, z.string().regex(SUB_PATTERN, "not a node name")).optional(),
  /** The active variant of the look (a key of `variants`). */
  variant: nameSchema.optional(),
  /** The variants of the look: material overrides by material name, over the overrides of the model. */
  variants: z
    .record(nameSchema, z.record(z.string().regex(SUB_PATTERN, "not a part name"), materialOverrideSchema))
    .optional(),
  ik: z
    .strictObject({
      leftHand: handGoalSchema.optional(),
      rightHand: handGoalSchema.optional(),
      look: lookGoalSchema.optional(),
    })
    .optional(),
});
export type CharacterValue = z.infer<typeof characterSchema>;
export type HandGoalValue = z.infer<typeof handGoalSchema>;
export type LookGoalValue = z.infer<typeof lookGoalSchema>;

/** A skinned model of the same entity as a character: the rig, the look variants and the IK goals. */
export const characterComponent = defineComponent({
  id: "character",
  schema: characterSchema.superRefine((value, ctx) => {
    if (value.variant !== undefined && !Object.hasOwn(value.variants ?? {}, value.variant))
      ctx.addIssue({ code: "custom", path: ["variant"], message: `no variant "${value.variant}"` });
  }),
  defaults: {},
  editor: {
    label: "Character",
    group: "Animation",
    fields: {
      rig: { widget: { kind: "string" }, label: "Rig profile" },
      bones: { widget: { kind: "map", item: { kind: "string" } }, label: "Bones", group: "Rig" },
      variant: { widget: { kind: "string" }, label: "Variant", group: "Look" },
      variants: {
        widget: { kind: "map", item: { kind: "custom", name: "materialOverrides" } },
        label: "Variants",
        group: "Look",
      },
      ik: { widget: { kind: "custom", name: "characterIk" }, label: "IK goals", group: "IK" },
    },
  },
});
