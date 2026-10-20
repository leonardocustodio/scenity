// SPDX-License-Identifier: Apache-2.0
/**
 * The build of a sound asset: the bytes of the WAV, Ogg or MP3 source as they are, in `<id>.<ext>`. The
 * stats of the record have the duration in seconds, the channels and the sample rate, so a player knows the length
 * of a sound before a download.
 */
import { readAudioInfo, type AudioFormat } from "../import/audioInfo";
import { extensionOf } from "../import/registry";
import type { AssetEntry } from "../types";
import type { Finding } from "./checks";
import { sourceBytes } from "./projectInputs";

/** The format of each source extension of a sound. */
const FORMATS: Readonly<Record<string, AudioFormat>> = {
  ".wav": "wav",
  ".ogg": "ogg",
  ".oga": "ogg",
  ".opus": "ogg",
  ".mp3": "mp3",
};

export interface AudioOutput {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly stats: { readonly duration: number; readonly channels: number; readonly sampleRate: number };
}

/** The built file of a sound asset and its stats, or null after a finding. */
export function audioOutput(dir: string, entry: AssetEntry, findings: Finding[]): AudioOutput | null {
  const error = (message: string): null => {
    findings.push({ level: "error", asset: entry.id, message });
    return null;
  };
  const extension = extensionOf(entry.sourcePath);
  const format = FORMATS[extension];
  if (format === undefined) return error(`a sound is a WAV, Ogg or MP3 file, not "${extension}"`);
  const bytes = sourceBytes(dir, entry, findings);
  if (bytes === null) return null;
  const info = readAudioInfo(bytes, format);
  if (info === null) return error(`the header of ${entry.sourcePath} is not the header of a ${format} file`);
  const stats = { duration: info.duration, channels: info.channels, sampleRate: info.sampleRate };
  return { file: `${entry.id}${extension === ".oga" || extension === ".opus" ? ".ogg" : extension}`, bytes, stats };
}
