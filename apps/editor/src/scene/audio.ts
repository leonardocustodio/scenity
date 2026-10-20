// SPDX-License-Identifier: Apache-2.0
/**
 * The sounds of the scene page: the audio player of @scenity/runtime over the page clock and the files of the asset
 * manifest. The core (in the worker or on the main thread) sends the audio frames. The player plays them with Web
 * Audio. A browser starts the audio context only after a user gesture. Thus the page calls `resume` on the first
 * pointer press or key press. `audio=0` in the URL disables the sounds.
 */
import { AudioPlayer } from "@scenity/runtime/audio";
import type { AssetManifest } from "@scenity/runtime/manifest";
import type { PageClock } from "./clock";

/** The asset part of the page that the player reads: the manifest and the URL of each file. */
export interface AudioFiles {
  readonly manifest: AssetManifest;
  readonly files: Readonly<Record<string, string>>;
}

/** The URL of the file of an `audio` asset (`asset:<id>`): the first file of its record. */
export function audioUrl({ manifest, files }: AudioFiles, asset: string): string {
  const id = asset.startsWith("asset:") ? asset.slice("asset:".length) : asset;
  const file = manifest.records.find((record) => record.id === id)?.files[0]?.file;
  const url = file === undefined ? undefined : files[file];
  if (url === undefined) throw new Error(`the manifest has no file for the sound ${asset}`);
  return url;
}

/** The sound files of the page (the waveforms of the Timeline read them), or null before the load. */
let sounds: AudioFiles | null = null;

/** The URL of the file of a sound asset of the page, or null. */
export function pageSoundUrl(asset: string): string | null {
  if (sounds === null) return null;
  try {
    return audioUrl(sounds, asset);
  } catch {
    return null;
  }
}

/** The audio player of the page, or null with `audio=0`. */
export function pageAudio(params: URLSearchParams, clock: PageClock | null, assets: AudioFiles): AudioPlayer | null {
  sounds = assets;
  if (params.get("audio") === "0") return null;
  const player = new AudioPlayer({
    clock: () => ({ t: clock?.now() ?? null, playing: clock?.playing ?? true }),
    fetch: async (asset) => {
      const response = await fetch(audioUrl(assets, asset));
      if (!response.ok) throw new Error(`the sound ${asset} did not load (${String(response.status)})`);
      return response.arrayBuffer();
    },
  });
  const resume = (): void => {
    void player.resume();
  };
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  return player;
}
