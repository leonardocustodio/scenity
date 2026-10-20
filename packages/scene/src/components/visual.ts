// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in components of the picture: `model`, `light`, `camera` and `environment` (scene level).
 */
import { z } from "zod";
import { assetRefSchema, colourSchema, entityRefSchema, SUB_PATTERN, vec3Schema } from "../schema/common";
import { defineComponent } from "./define";
import { effectEditorFields, effectFields } from "./effects";

const shares = { kind: "number", min: 0, max: 1, step: 0.01 } as const;

/**
 * The override of one part of a model. `material` replaces the material of the part with a material asset. The
 * other values change a copy of the material of the part (or of the material asset).
 */
export const materialOverrideSchema = z.strictObject({
  material: assetRefSchema.optional(),
  colour: colourSchema.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
});
/**
 * The levels of detail of a model. The asset build gives the levels (one file for each LOD tier). `screen`
 * holds the screen sizes from large to small: the diameter of the model over the height of the view. Under
 * `screen[i]` the model takes the level `i + 1`. With a camera under the control of the user (an editor view), a level
 * changes only when the size passes the threshold by the share `hysteresis`. A fixed camera uses no hysteresis, so a
 * seek gives the frame of a play.
 */
export const modelLodSchema = z.strictObject({
  screen: z.array(z.number().gt(0).max(16)).min(1).max(8),
  hysteresis: z.number().min(0).max(0.5).optional(),
});
export type ModelLodValue = z.infer<typeof modelLodSchema>;

export const modelSchema = z.strictObject({
  asset: assetRefSchema,
  /**
   * The material overrides by part. A key `mesh:<name>` names a mesh or a node of the model: the override
   * applies to that mesh and to each mesh under that node. The name is the node name after the glTF loader, which
   * changes a space to `_`. Another key is a material name of the model. A mesh key comes before a material key.
   */
  materials: z.record(z.string().regex(SUB_PATTERN, "not a part name"), materialOverrideSchema).optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  /** The levels of detail. With no value, the model shows the level of the quality tier. */
  lod: modelLodSchema.optional(),
});
export type ModelValue = z.infer<typeof modelSchema>;

/** The prefix of an override key that names a mesh or a node of a model. */
export const MESH_PART_PREFIX = "mesh:";

/** A model asset, with optional material overrides for each part. */
export const modelComponent = defineComponent({
  id: "model",
  schema: modelSchema,
  defaults: { castShadow: true, receiveShadow: true },
  editor: {
    label: "Model",
    group: "Render",
    fields: {
      asset: { widget: { kind: "assetRef", assetKind: "model" }, label: "Model" },
      materials: {
        widget: { kind: "map", item: { kind: "custom", name: "materialOverride" } },
        label: "Material overrides",
      },
      castShadow: { widget: { kind: "boolean" }, label: "Cast shadow", group: "Shadow" },
      receiveShadow: { widget: { kind: "boolean" }, label: "Receive shadow", group: "Shadow" },
      lod: { widget: { kind: "custom", name: "lodChain" }, label: "Levels of detail", group: "Detail" },
    },
  },
});

/**
 * The shadow camera of a light, in the frame of the light. A directional light uses the box (left, right, top,
 * bottom) and the depth range (near, far). A spot or point light uses near and far. A value that the document gives
 * stays. The runtime fits each other value to the bounds of the shadow casters.
 */
export const shadowCameraSchema = z.strictObject({
  left: z.number().optional(),
  right: z.number().optional(),
  top: z.number().optional(),
  bottom: z.number().optional(),
  near: z.number().optional(),
  far: z.number().gt(0).optional(),
});
export type ShadowCameraValue = z.infer<typeof shadowCameraSchema>;

export const LIGHT_TYPES = ["directional", "point", "spot", "ambient", "hemisphere"] as const;
export const lightSchema = z.strictObject({
  type: z.enum(LIGHT_TYPES),
  colour: colourSchema.optional(),
  /** The ground colour of a hemisphere light. */
  groundColour: colourSchema.optional(),
  intensity: z.number().min(0).optional(),
  /** The range of a point or spot light in metres; 0 is no limit. */
  range: z.number().min(0).optional(),
  /** The half angle of the cone of a spot light in radians. */
  angle: z
    .number()
    .gt(0)
    .max(Math.PI / 2)
    .optional(),
  penumbra: z.number().min(0).max(1).optional(),
  shadow: z.boolean().optional(),
  /**
   * The point that a directional or spot light lights: a world point or an entity reference. With no target,
   * the light points along -Z of the entity.
   */
  target: z.union([vec3Schema, entityRefSchema]).optional(),
  shadowCamera: shadowCameraSchema.optional(),
  shadowBias: z.number().optional(),
  shadowNormalBias: z.number().min(0).optional(),
});
export type LightValue = z.infer<typeof lightSchema>;

/** A light. A directional or spot light points at its target, else along -Z of the entity. */
export const lightComponent = defineComponent({
  id: "light",
  schema: lightSchema,
  defaults: { colour: "#ffffff", intensity: 1, range: 0, angle: 0.785398, penumbra: 0, shadow: false },
  editor: {
    label: "Light",
    group: "Render",
    fields: {
      type: { widget: { kind: "enum", options: LIGHT_TYPES }, label: "Type" },
      colour: { widget: { kind: "colour" }, label: "Colour" },
      groundColour: { widget: { kind: "colour" }, label: "Ground colour" },
      intensity: { widget: { kind: "number", min: 0, step: 0.1 }, label: "Intensity" },
      range: { widget: { kind: "number", unit: "m", min: 0, step: 0.1 }, label: "Range" },
      angle: { widget: { kind: "number", unit: "rad", min: 0, max: Math.PI / 2, step: 0.01 }, label: "Angle" },
      penumbra: { widget: shares, label: "Penumbra" },
      shadow: { widget: { kind: "boolean" }, label: "Shadow", group: "Shadow" },
      target: { widget: { kind: "custom", name: "pointOrEntity" }, label: "Target" },
      shadowCamera: { widget: { kind: "custom", name: "shadowCamera" }, label: "Shadow camera", group: "Shadow" },
      shadowBias: { widget: { kind: "number", step: 0.0001 }, label: "Shadow bias", group: "Shadow" },
      shadowNormalBias: {
        widget: { kind: "number", min: 0, step: 0.005 },
        label: "Shadow normal bias",
        group: "Shadow",
      },
    },
  },
});

/**
 * The box that a camera keeps in view: the bounds of a list of entities, or a box in world space, and a margin in
 * metres. The camera widens its field of view up to `maxFov` (degrees) when the box needs it.
 */
export const safeFrameSchema = z.strictObject({
  entities: z.array(entityRefSchema).optional(),
  min: vec3Schema.optional(),
  max: vec3Schema.optional(),
  margin: z.number().min(0).optional(),
  maxFov: z.number().gt(0).lt(180).optional(),
});
export const cameraSchema = z.strictObject({
  /** The vertical field of view in degrees, as three.js. */
  fov: z.number().gt(0).lt(180).optional(),
  /** The clip planes in metres. The runtime calculates an absent plane from the bounds of the scene. */
  near: z.number().gt(0).optional(),
  far: z.number().gt(0).optional(),
  /** The point that the camera looks at: a world point or an entity reference. */
  target: z.union([vec3Schema, entityRefSchema]).optional(),
  safeFrame: safeFrameSchema.optional(),
});
export type CameraValue = z.infer<typeof cameraSchema>;

/**
 * A camera. With no target, it looks along -Z of the entity. With a safe frame, `fov` is the narrowest field of view.
 * The defaults have no clip planes: the runtime calculates them from the bounds of the scene.
 */
export const cameraComponent = defineComponent({
  id: "camera",
  schema: cameraSchema,
  defaults: { fov: 50 },
  editor: {
    label: "Camera",
    group: "Render",
    fields: {
      fov: { widget: { kind: "number", unit: "deg", min: 1, max: 179, step: 1 }, label: "Field of view" },
      near: { widget: { kind: "number", unit: "m", min: 0.001, step: 0.01 }, label: "Near", group: "Clip" },
      far: { widget: { kind: "number", unit: "m", min: 0.01, step: 1 }, label: "Far", group: "Clip" },
      target: { widget: { kind: "custom", name: "pointOrEntity" }, label: "Target" },
      safeFrame: { widget: { kind: "custom", name: "safeFrame" }, label: "Safe frame" },
    },
  },
});

export const TONE_MAPPINGS = ["none", "linear", "reinhard", "cineon", "aces", "agx", "neutral"] as const;
export const fogSchema = z.union([
  z.strictObject({ type: z.literal("linear"), colour: colourSchema, near: z.number().min(0), far: z.number().gt(0) }),
  z.strictObject({ type: z.literal("exp2"), colour: colourSchema, density: z.number().min(0) }),
]);
export const environmentSchema = z.strictObject({
  background: colourSchema.optional(),
  toneMapping: z.enum(TONE_MAPPINGS).optional(),
  exposure: z.number().gt(0).optional(),
  /** The environment map (an HDR or KTX2 asset) for the reflections and the image light. */
  map: assetRefSchema.optional(),
  mapIntensity: z.number().min(0).optional(),
  fog: fogSchema.optional(),
  /** Ambient occlusion, bloom, anti-aliasing and the selection outline (effects.ts). */
  ...effectFields,
});
export type EnvironmentValue = z.infer<typeof environmentSchema>;

/** The scene-level values. The scene document keeps them in its field `environment`. */
export const environmentComponent = defineComponent({
  id: "environment",
  site: "scene",
  schema: environmentSchema,
  defaults: { background: "#000000", toneMapping: "aces", exposure: 1, mapIntensity: 1 },
  editor: {
    label: "Environment",
    group: "Scene",
    fields: {
      background: { widget: { kind: "colour" }, label: "Background" },
      toneMapping: { widget: { kind: "enum", options: TONE_MAPPINGS }, label: "Tone mapping" },
      exposure: { widget: { kind: "number", min: 0.01, step: 0.05 }, label: "Exposure" },
      map: { widget: { kind: "assetRef", assetKind: "environment" }, label: "Environment map" },
      mapIntensity: { widget: { kind: "number", min: 0, step: 0.05 }, label: "Map intensity" },
      fog: { widget: { kind: "custom", name: "fog" }, label: "Fog" },
      ...effectEditorFields,
    },
  },
});
