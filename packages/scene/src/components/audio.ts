// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in `audioSource` component: a sound of an entity. The page plays the sound on the main thread with Web
 * Audio. A spatial sound comes from the world place of the entity, and the camera is the listener. An `audio`
 * track of a sequence plays and stops the sound at fixed times, so a seek gives the sound of a play.
 */
import { z } from "zod";
import { assetRefSchema } from "../schema/common";
import { defineComponent } from "./define";

export const DISTANCE_MODELS = ["linear", "inverse", "exponential"] as const;

export const audioSourceSchema = z.strictObject({
  /** The `audio` asset. An audio key of a sequence can play another asset on the same entity. */
  asset: assetRefSchema.optional(),
  /** The gain of the sound: 1 is the level of the file. */
  volume: z.number().min(0).max(4).optional(),
  /** Play the sound again from its start at its end. */
  loop: z.boolean().optional(),
  /** True: the sound comes from the world place of the entity. False: the sound has no place. */
  spatial: z.boolean().optional(),
  /** The distance in metres where the level starts to fall (Web Audio `refDistance`). */
  refDistance: z.number().gt(0).optional(),
  /** How fast the level falls after the reference distance (Web Audio `rolloffFactor`). */
  rolloff: z.number().min(0).optional(),
  /** The distance in metres where a `linear` model gives no sound (Web Audio `maxDistance`). */
  maxDistance: z.number().gt(0).optional(),
  distanceModel: z.enum(DISTANCE_MODELS).optional(),
  /** Play the asset from t = 0 of the time line (with no sequence: from the load). */
  autoplay: z.boolean().optional(),
});
export type AudioSourceValue = z.infer<typeof audioSourceSchema>;

/** The `audioSource` component with the defaults of the registry. */
export type AudioSourceFilled = {
  readonly [K in Exclude<keyof AudioSourceValue, "asset">]-?: NonNullable<AudioSourceValue[K]>;
} & {
  readonly asset?: string;
};

export const AUDIO_SOURCE_DEFAULTS = {
  volume: 1,
  loop: false,
  spatial: true,
  refDistance: 1,
  rolloff: 1,
  maxDistance: 10000,
  distanceModel: "inverse",
  autoplay: false,
} as const satisfies Omit<AudioSourceFilled, "asset">;

/** A sound of an entity: the asset, the level, the loop and the spatial settings. */
export const audioSourceComponent = defineComponent({
  id: "audioSource",
  schema: audioSourceSchema,
  defaults: AUDIO_SOURCE_DEFAULTS,
  editor: {
    label: "Audio source",
    group: "Audio",
    fields: {
      asset: { widget: { kind: "assetRef", assetKind: "audio" }, label: "Sound" },
      volume: { widget: { kind: "number", min: 0, max: 4, step: 0.05 }, label: "Volume" },
      loop: { widget: { kind: "boolean" }, label: "Loop" },
      autoplay: { widget: { kind: "boolean" }, label: "Autoplay" },
      spatial: { widget: { kind: "boolean" }, label: "Spatial", group: "Spatial" },
      refDistance: {
        widget: { kind: "number", unit: "m", min: 0.01, step: 0.1 },
        label: "Reference distance",
        group: "Spatial",
      },
      rolloff: { widget: { kind: "number", min: 0, step: 0.1 }, label: "Rolloff", group: "Spatial" },
      maxDistance: {
        widget: { kind: "number", unit: "m", min: 0.01, step: 1 },
        label: "Max distance",
        group: "Spatial",
      },
      distanceModel: { widget: { kind: "enum", options: DISTANCE_MODELS }, label: "Distance model", group: "Spatial" },
    },
  },
});
