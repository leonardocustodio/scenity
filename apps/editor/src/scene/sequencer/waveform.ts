// SPDX-License-Identifier: Apache-2.0
/**
 * The waveforms of the audio tracks of the Timeline. A sound file decodes once (Web Audio)
 * into its peaks: the largest sample of each of a count of equal parts. The segments of a track are the parts of the
 * time line where a play key plays its sound: from the key time to the end of the sound or to the next key. The
 * peaks and the segments are pure; `soundPeaks` reads the file.
 */
import type { EntityDocument } from "@scenity/scene";
import type { Track } from "@scenity/scene/sequence";

/** The peaks of a sound and its length (ms). */
export interface SoundPeaks {
  readonly peaks: Float32Array;
  readonly ms: number;
}

/** The largest absolute sample of each of `count` equal parts of the samples. */
export function peakBuckets(samples: Float32Array, count: number): Float32Array {
  const out = new Float32Array(Math.max(1, count));
  const size = samples.length / out.length;
  for (let bucket = 0; bucket < out.length; bucket += 1) {
    let peak = 0;
    const end = Math.min(samples.length, Math.floor((bucket + 1) * size));
    for (let at = Math.floor(bucket * size); at < end; at += 1) peak = Math.max(peak, Math.abs(samples[at] ?? 0));
    out[bucket] = peak;
  }
  return out;
}

/** One part of the time line where a play key plays a sound. */
export interface SoundSegment {
  readonly sound: string;
  /** The time line range (ms). */
  readonly from: number;
  readonly to: number;
  /** The time in the sound at `from` (ms). */
  readonly offset: number;
}

/** The segments of an audio track. `length` gives the length of a sound (ms), or null when it is not known yet. */
export function soundSegments(
  track: Track,
  scene: EntityDocument,
  duration: number,
  length: (sound: string) => number | null,
): SoundSegment[] {
  if (track.kind !== "audio") return [];
  const source = scene.entities[track.entity]?.components.audioSource as { asset?: unknown } | undefined;
  const fallback = typeof source?.asset === "string" ? source.asset : null;
  return track.keys.flatMap((key, index): SoundSegment[] => {
    const sound = key.sound ?? fallback;
    if (!key.play || sound === null) return [];
    const offset = key.offset ?? 0;
    const next = track.keys[index + 1]?.t ?? duration;
    const ms = length(sound);
    const to = Math.min(next, duration, ms === null ? next : key.t + Math.max(0, ms - offset));
    return to > key.t ? [{ sound, from: key.t, to, offset }] : [];
  });
}

/** The decoded peaks by URL. */
const cache = new Map<string, Promise<SoundPeaks | null>>();
/** The count of the peaks of a sound. */
const PEAKS = 2048;

/** The peaks of the sound file at `url` (null when it does not load or decode). */
export function soundPeaks(url: string): Promise<SoundPeaks | null> {
  const known = cache.get(url);
  if (known !== undefined) return known;
  const loaded = (async (): Promise<SoundPeaks | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const context = new OfflineAudioContext(1, 1, 44_100);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return { peaks: peakBuckets(buffer.getChannelData(0), PEAKS), ms: buffer.duration * 1000 };
    } catch {
      return null;
    }
  })();
  cache.set(url, loaded);
  return loaded;
}
