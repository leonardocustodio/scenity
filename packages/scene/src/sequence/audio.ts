// SPDX-License-Identifier: Apache-2.0
/**
 * The sounds of a frame: which sounds play at a time `t`, and the position in each sound. The functions are pure. A
 * sound has a start on the time line, so the position at `t` is `t - start`. Thus a seek gives the sound of a play. A
 * seek after the end of a sound with no loop gives no sound.
 *
 * - An `audio` track plays the sound of its entity from a play key to the next key of the track, or to the end of
 *   the sound. Each play key is a new voice (`track:<track>:<key>`), so a second play key starts the sound again.
 * - An entity with an `audioSource` component and `autoplay` plays its asset from t = 0 (`auto:<entity>`).
 *
 * The duration of a sound comes from the file, and only the player decodes the file. Thus `soundPosition` takes the
 * duration as an argument.
 */
import { AUDIO_SOURCE_DEFAULTS, type AudioSourceFilled } from "../components/audio";
import type { ComponentRegistry } from "../components/registry";
import type { SceneDocument } from "../schema/documents";
import type { SequenceDocument } from "../schema/sequence";
import { sampleTrack } from "./sample";

/** A sound that plays at the time of a frame, before the check of its end. */
export interface SoundCue {
  /** The ID of the voice: `track:<track index>:<key index>` or `auto:<entity>`. */
  readonly id: string;
  readonly entity: string;
  /** The `audio` asset (`asset:<id>`). */
  readonly asset: string;
  /** The time on the time line where the position in the sound is 0 (it can be below 0). */
  readonly start: number;
  /** The `audioSource` values of the entity with the defaults (the defaults when the entity has no component). */
  readonly source: AudioSourceFilled;
}

/** The `audioSource` component of an entity with the defaults of the registry, or the defaults. */
function sourceOf(scene: SceneDocument, entity: string, registry: ComponentRegistry): AudioSourceFilled {
  const stored = scene.entities[entity]?.components.audioSource;
  if (stored === undefined) return { ...AUDIO_SOURCE_DEFAULTS };
  return registry.fill("audioSource", stored) as AudioSourceFilled;
}

/**
 * The sound cues at `t` in a stable order: the audio tracks in file order, then the autoplay entities in ID order.
 * `scene` is the scene of the frame (the evaluator gives it), so a property track can change the values of a source.
 * The result does not include a cue whose entity is not in the scene, or a cue that has no asset.
 */
export function soundCues(
  scene: SceneDocument,
  sequence: SequenceDocument | null,
  t: number,
  registry: ComponentRegistry,
): SoundCue[] {
  const cues: SoundCue[] = [];
  sequence?.tracks.forEach((track, index) => {
    if (track.kind !== "audio" || !Object.hasOwn(scene.entities, track.entity)) return;
    const sample = sampleTrack(track, t);
    const cue = sample.kind === "audio" ? sample.cue : undefined;
    if (cue === undefined) return;
    const source = sourceOf(scene, track.entity, registry);
    const asset = cue.sound ?? source.asset;
    if (asset === undefined) return;
    cues.push({
      id: `track:${String(index)}:${String(cue.key)}`,
      entity: track.entity,
      asset,
      start: cue.start,
      source,
    });
  });
  for (const entity of Object.keys(scene.entities).sort()) {
    if (scene.entities[entity]?.components.audioSource === undefined) continue;
    const source = sourceOf(scene, entity, registry);
    if (!source.autoplay || source.asset === undefined) continue;
    cues.push({ id: `auto:${entity}`, entity, asset: source.asset, start: 0, source });
  }
  return cues;
}

/**
 * The position in a sound in ms, from the time since its start (`elapsed = t - start`), or null when the sound does
 * not play: before its start, or at and after its end with no loop. An unknown duration gives `elapsed`.
 */
export function soundPosition(elapsed: number, duration: number | undefined, loop: boolean): number | null {
  if (elapsed < 0) return null;
  if (duration === undefined) return elapsed;
  if (duration <= 0) return null;
  if (loop) return elapsed % duration;
  return elapsed < duration ? elapsed : null;
}

/** A sound that plays at a time, with its position in ms. */
export interface AudibleSound {
  readonly cue: SoundCue;
  readonly position: number;
}

/** The cues that play at `t` and the position in each. `durationOf` gives the duration of an asset in ms. */
export function audibleAt(
  cues: readonly SoundCue[],
  t: number,
  durationOf: (asset: string) => number | undefined,
): AudibleSound[] {
  const out: AudibleSound[] = [];
  for (const cue of cues) {
    const position = soundPosition(t - cue.start, durationOf(cue.asset), cue.source.loop);
    if (position !== null) out.push({ cue, position });
  }
  return out;
}
