// SPDX-License-Identifier: Apache-2.0
/**
 * The sound importers: WAV, Ogg (Vorbis or Opus) and MP3. An import checks the header of the file against
 * its extension and copies the bytes as they are into the output folder. The report has the channels, the sample
 * rate and the duration in seconds; the build copies the file and keeps the same facts (build/project.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readAudioInfo, type AudioFormat } from "./audioInfo";
import { defineImporter, type ImportContext, type Importer, type ImporterResult } from "./registry";
import { audioImportSettingsSchema, type AudioImportSettings } from "./settings";

/** The name of the main file of a sound import, by format. */
export const AUDIO_FILES: Readonly<Record<AudioFormat, string>> = {
  wav: "audio.wav",
  ogg: "audio.ogg",
  mp3: "audio.mp3",
};

function runAudio(context: ImportContext<AudioImportSettings>, format: AudioFormat): ImporterResult {
  const bytes = readFileSync(context.source);
  const info = readAudioInfo(bytes, format);
  if (info === null) throw new Error(`${basename(context.source)}: the header is not the header of a ${format} file`);
  const file = AUDIO_FILES[format];
  writeFileSync(join(context.outDir, file), bytes);
  const warnings = info.duration > 0 ? [] : ["the sound has no length"];
  return { files: [file], warnings, report: { ...info, bytes: bytes.byteLength } };
}

function audioImporter(format: AudioFormat, extensions: readonly string[]): Importer {
  return defineImporter({
    name: format,
    version: 1,
    extensions,
    kinds: ["audio"],
    schema: audioImportSettingsSchema,
    run: (context) => Promise.resolve(runAudio(context, format)),
  });
}

/** The built-in sound importers: wav, ogg and mp3. */
export function audioImporters(): Importer[] {
  return [
    audioImporter("wav", [".wav"]),
    audioImporter("ogg", [".ogg", ".oga", ".opus"]),
    audioImporter("mp3", [".mp3"]),
  ];
}
