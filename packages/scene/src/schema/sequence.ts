// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the sequence document `*.sequence.json`: tracks and keys over time. Time is an integer count of
 * milliseconds. The keys of a track are in time order. Keys at the same time apply in the order of the file. A
 * simulation plugin gives the meaning of the `action` keys.
 */
import { z } from "zod";
import {
  assetRefSchema,
  COMPONENT_ID_PATTERN,
  entityRefSchema,
  ID_PATTERN,
  idSchema,
  quatSchema,
  vec3Schema,
} from "./common";
import { ruleListSchema } from "./rules";

/** A time on the time line of a sequence: an integer count of milliseconds, 0 or more. */
export const timeSchema = z.number().int().min(0);

/** The pattern of a plugin ID: the part of an action name before the first dot. */
export const PLUGIN_ID_PATTERN = /^[a-z][A-Za-z0-9-]{0,63}$/;
/** The pattern of an action name: `<plugin ID>.<name>`, for example `doors.open`. */
export const ACTION_PATTERN = /^[a-z][A-Za-z0-9-]{0,63}\.[A-Za-z0-9_.:-]{1,64}$/;
/** The pattern of an event name and of a marker name. */
export const NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The pattern of the path of a property track: a component ID, then JSON Pointer tokens (`camera/fov`). */
export const PROPERTY_PATH_PATTERN = new RegExp(`^${COMPONENT_ID_PATTERN.source.slice(1, -1)}(/[^/]+)*$`);

export const pluginIdSchema = z.string().regex(PLUGIN_ID_PATTERN, "a plugin ID is a lower-case word");
const nameSchema = z.string().regex(NAME_PATTERN, "a name has 1 to 64 letters, digits, '_', '.', ':' or '-'");
const argsSchema = z.record(z.string(), z.json());
/** A reference to a camera entity: `entity:<id>`, with no socket or bone. */
const cameraRefSchema = z
  .string()
  .regex(new RegExp(`^entity:${ID_PATTERN.source.slice(1, -1)}$`), "a camera reference is entity:<id>");

/** The ease names. The ease of a key gives the curve from the key before it to the key. */
export const EASE_NAMES = ["step", "linear", "in", "out", "inOut"] as const;
const unitSchema = z.number().min(0).max(1);
/** A cubic Bézier ease as in CSS: the control points `[x1, y1, x2, y2]`; x1 and x2 are in 0..1. */
export const bezierEaseSchema = z.strictObject({ bezier: z.tuple([unitSchema, z.number(), unitSchema, z.number()]) });
export const easeSchema = z.union([z.enum(EASE_NAMES), bezierEaseSchema]);

/** The fields of all tracks: an optional label for the track list. */
const trackBase = { name: z.string().min(1).max(200).optional() };

export const propertyKeySchema = z.strictObject({ t: timeSchema, value: z.json(), ease: easeSchema.optional() });
/** A value of a component over time. A number or an array of numbers interpolates; other values step. */
export const propertyTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("property"),
  entity: idSchema,
  path: z.string().regex(PROPERTY_PATH_PATTERN, "a property path is <component>/<field>/..."),
  keys: z.array(propertyKeySchema),
});

/** A key of a transform track. Each part is optional: the track samples each part over the keys that hold it. */
export const transformKeySchema = z.strictObject({
  t: timeSchema,
  position: vec3Schema.optional(),
  rotation: quatSchema.optional(),
  scale: vec3Schema.optional(),
  ease: easeSchema.optional(),
});
export const transformTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("transform"),
  entity: idSchema,
  keys: z.array(transformKeySchema),
});

export const visibilityKeySchema = z.strictObject({ t: timeSchema, visible: z.boolean() });
export const visibilityTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("visibility"),
  entity: idSchema,
  keys: z.array(visibilityKeySchema),
});

/** A named event with arguments and no value (a sound cue, a caption, a mark for a plugin system). */
export const eventKeySchema = z.strictObject({ t: timeSchema, name: nameSchema, args: argsSchema.optional() });
export const eventTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("event"),
  entity: idSchema.optional(),
  keys: z.array(eventKeySchema),
});

/** An action for a simulation plugin: the plugin with the ID before the first dot reduces it. */
export const actionKeySchema = z.strictObject({
  t: timeSchema,
  action: z.string().regex(ACTION_PATTERN, "an action is <plugin>.<name>"),
  args: argsSchema.optional(),
});
export const actionTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("action"),
  entity: idSchema.optional(),
  keys: z.array(actionKeySchema),
});

/**
 * A clip from the key time: the asset of the clip (null stops the clip), the speed (default 1), the loop flag and the
 * crossfade time from the clip before it in ms (default 0). The animator reads these keys.
 *
 * The asset is a model, a skinned model or an animation asset. `name` is the name of a clip in it (default:
 * the first clip of the asset). The clip of an asset that is not the model of the entity plays retargeted.
 */
export const animationKeySchema = z.strictObject({
  t: timeSchema,
  clip: assetRefSchema.nullable(),
  name: z.string().min(1).max(256).optional(),
  speed: z.number().min(0).optional(),
  loop: z.boolean().optional(),
  blend: timeSchema.optional(),
});
export const animationTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("animation"),
  entity: idSchema,
  keys: z.array(animationKeySchema),
});

/** A camera cut: from the key time, the frame shows the view of the camera entity. */
export const cameraKeySchema = z.strictObject({ t: timeSchema, camera: cameraRefSchema });
export const cameraTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("camera"),
  keys: z.array(cameraKeySchema),
});

/**
 * A parent over a time range: `entity:<id>#<socket or bone>`, `entity:<id>`, or null for no attach parent. A bone is
 * a canonical humanoid bone of the character (`leftHand`), else a node name of its model. `position` and
 * `rotation` give the local place under the parent. With neither, the entity keeps its world place at the key time.
 * After a null key, the entity stays at its world place of the key time.
 */
export const attachKeySchema = z.strictObject({
  t: timeSchema,
  to: entityRefSchema.nullable(),
  position: vec3Schema.optional(),
  rotation: quatSchema.optional(),
});
export const attachTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("attach"),
  entity: idSchema,
  keys: z.array(attachKeySchema),
});

/**
 * A play or a stop of the sound of an entity. A play key starts `sound` (default: the asset of the
 * `audioSource` component of the entity) at `offset` ms into the sound (default 0). The sound plays to its end, or
 * to the next key of the track. A stop key (`play: false`) stops it.
 */
export const audioKeySchema = z.strictObject({
  t: timeSchema,
  play: z.boolean(),
  sound: assetRefSchema.optional(),
  offset: timeSchema.optional(),
});
export const audioTrackSchema = z.strictObject({
  ...trackBase,
  kind: z.literal("audio"),
  entity: idSchema,
  keys: z.array(audioKeySchema),
});

export const trackSchema = z.discriminatedUnion("kind", [
  propertyTrackSchema,
  transformTrackSchema,
  visibilityTrackSchema,
  eventTrackSchema,
  actionTrackSchema,
  animationTrackSchema,
  cameraTrackSchema,
  attachTrackSchema,
  audioTrackSchema,
]);
export const TRACK_KINDS = [
  "property",
  "transform",
  "visibility",
  "event",
  "action",
  "animation",
  "camera",
  "attach",
  "audio",
] as const;

const sequenceShape = {
  format: z.literal("scenity.sequence/1"),
  id: idSchema,
  name: z.string().min(1).max(200).optional(),
  /** The ID of the scene that the sequence animates. */
  scene: idSchema,
  /** The length of the time line in ms. Each key and each marker is in 0..duration. */
  duration: timeSchema,
  loop: z.boolean().optional(),
  /** The named times in ms (the moments of a take). */
  markers: z.record(nameSchema, timeSchema).optional(),
  /** The initial state parameters by simulation plugin ID. Each plugin reads its own value. */
  initial: z.record(pluginIdSchema, z.json()).optional(),
  tracks: z.array(trackSchema),
  /** The rules of the sequence (the default scope is `sequence`: each marker and key time). */
  rules: ruleListSchema.optional(),
};

const sequenceObject = z.strictObject(sequenceShape);

/** The checks over more than one field: the keys are in time order, and each time is in 0..duration. */
function checkTimes(doc: z.output<typeof sequenceObject>, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  for (const [name, t] of Object.entries(doc.markers ?? {})) {
    if (t > doc.duration) issue(["markers", name], `the marker is after the duration (${String(doc.duration)} ms)`);
  }
  doc.tracks.forEach((track, index) => {
    let before = 0;
    track.keys.forEach((key, keyIndex) => {
      const path = ["tracks", index, "keys", keyIndex, "t"];
      if (key.t > doc.duration) issue(path, `the key is after the duration (${String(doc.duration)} ms)`);
      if (key.t < before) issue(path, "the keys of a track are in time order");
      before = key.t;
    });
  });
}

export const sequenceSchema = sequenceObject.superRefine(checkTimes);

export type Ease = z.infer<typeof easeSchema>;
export type EaseName = (typeof EASE_NAMES)[number];
export type PropertyTrackKey = z.infer<typeof propertyKeySchema>;
export type TransformKey = z.infer<typeof transformKeySchema>;
export type VisibilityKey = z.infer<typeof visibilityKeySchema>;
export type EventKey = z.infer<typeof eventKeySchema>;
export type ActionKey = z.infer<typeof actionKeySchema>;
export type AnimationKey = z.infer<typeof animationKeySchema>;
export type CameraKey = z.infer<typeof cameraKeySchema>;
export type AttachKey = z.infer<typeof attachKeySchema>;
export type AudioKey = z.infer<typeof audioKeySchema>;
export type PropertyTrack = z.infer<typeof propertyTrackSchema>;
export type TransformTrack = z.infer<typeof transformTrackSchema>;
export type VisibilityTrack = z.infer<typeof visibilityTrackSchema>;
export type EventTrack = z.infer<typeof eventTrackSchema>;
export type ActionTrack = z.infer<typeof actionTrackSchema>;
export type AnimationTrack = z.infer<typeof animationTrackSchema>;
export type CameraTrack = z.infer<typeof cameraTrackSchema>;
export type AttachTrack = z.infer<typeof attachTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type Track = z.infer<typeof trackSchema>;
export type TrackKind = Track["kind"];
export type SequenceDocument = z.infer<typeof sequenceSchema>;
