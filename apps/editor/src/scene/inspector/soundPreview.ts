// SPDX-License-Identifier: Apache-2.0
/**
 * The preview of a sound in the inspector: a press plays the sound asset of a field once,
 * with Web Audio on the main thread, with no part of the scene (no level, no spatial settings). A second press stops
 * it. One preview plays at a time. The press is the user gesture that lets the audio context start.
 */
import { shallowRef, type ShallowRef } from "vue";
import { pageSoundUrl } from "../audio";

/** The sound asset that plays now, or null. */
export const previewing: ShallowRef<string | null> = shallowRef(null);

let context: AudioContext | null = null;
let voice: AudioBufferSourceNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function stop(): void {
  voice?.stop();
  voice = null;
  previewing.value = null;
}

/** The decoded buffer of a sound file (null when it does not load). */
function bufferOf(audio: AudioContext, url: string): Promise<AudioBuffer | null> {
  const known = buffers.get(url);
  if (known !== undefined) return known;
  const loaded = fetch(url)
    .then(async (response) => (response.ok ? audio.decodeAudioData(await response.arrayBuffer()) : null))
    .catch(() => null);
  buffers.set(url, loaded);
  return loaded;
}

/** Play the sound asset once, or stop it when it plays now; false when the sound does not load. */
export async function toggleSoundPreview(asset: string): Promise<boolean> {
  if (previewing.value === asset) {
    stop();
    return true;
  }
  stop();
  const url = pageSoundUrl(asset);
  if (url === null) return false;
  context ??= new AudioContext();
  const audio = context;
  await audio.resume();
  const buffer = await bufferOf(audio, url);
  if (buffer === null) return false;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.addEventListener("ended", () => {
    if (voice === source) stop();
  });
  source.start();
  voice = source;
  previewing.value = asset;
  return true;
}
