// SPDX-License-Identifier: Apache-2.0
// The sound assets: the header read of WAV, Ogg (Vorbis, Opus) and MP3 files, the sound importers (a copy
// with the duration and the channels in the report) and the build of a sound (`<id>.<ext>` with the stats in the
// manifest record). The test files come from code: a tone as WAV, Ogg pages with a head and a last granule position,
// and MP3 frames with no audio data.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../src/build/project";
import { mp3Frame, readAudioInfo } from "../src/import/audioInfo";
import { importAsset } from "../src/import/run";
import { writeAssetRecord } from "../src/record";
import { put, record, removeTemps, tempProject } from "./helpers";

afterEach(removeTemps);

/** A 16-bit PCM WAV file of a 440 Hz tone. */
function wav(channels: number, rate: number, seconds: number): Uint8Array {
  const frames = Math.round(rate * seconds);
  const data = frames * channels * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data, true);
  for (let i = 0; i < frames * channels; i += 1) {
    view.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * Math.floor(i / channels)) / rate)), true);
  }
  return bytes;
}

/** One Ogg page with one packet. */
function oggPage(granule: bigint, packet: Uint8Array, type: number): Uint8Array {
  const page = new Uint8Array(28 + packet.length);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, type]);
  view.setBigUint64(6, granule, true);
  page[26] = 1;
  page[27] = packet.length;
  page.set(packet, 28);
  return page;
}

function ogg(head: Uint8Array, lastGranule: bigint): Uint8Array {
  const first = oggPage(0n, head, 2);
  const last = oggPage(lastGranule, new Uint8Array(10), 4);
  const out = new Uint8Array(first.length + last.length);
  out.set(first);
  out.set(last, first.length);
  return out;
}

function vorbisHead(channels: number, rate: number): Uint8Array {
  const head = new Uint8Array(30);
  head.set([1, ...new TextEncoder().encode("vorbis")]);
  head[11] = channels;
  new DataView(head.buffer).setUint32(12, rate, true);
  return head;
}

function opusHead(channels: number, preSkip: number, rate: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = channels;
  const view = new DataView(head.buffer);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, rate, true);
  return head;
}

/** An MP3 file: an empty ID3v2 tag and `count` frames of MPEG-1 layer III, 128 kbps, 44.1 kHz, mono. */
function mp3(count: number): Uint8Array {
  const header = 0xfffb90c0;
  const size = mp3Frame(header)?.bytes ?? 0;
  const bytes = new Uint8Array(10 + count * size);
  bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i += 1) view.setUint32(10 + i * size, header, false);
  return bytes;
}

describe("the header read of a sound", () => {
  test("WAV: the channels, the rate and the duration from the data chunk", () => {
    expect(readAudioInfo(wav(2, 22050, 0.5), "wav")).toEqual({
      format: "wav",
      codec: "pcm",
      channels: 2,
      sampleRate: 22050,
      duration: 0.5,
    });
  });

  test("Ogg: Vorbis counts at its rate, Opus at 48 kHz less the pre-skip", () => {
    expect(readAudioInfo(ogg(vorbisHead(1, 44100), 66150n), "ogg")).toMatchObject({
      codec: "vorbis",
      channels: 1,
      sampleRate: 44100,
      duration: 1.5,
    });
    expect(readAudioInfo(ogg(opusHead(2, 312, 44100), 96312n), "ogg")).toMatchObject({
      codec: "opus",
      channels: 2,
      sampleRate: 44100,
      duration: 2,
    });
  });

  test("MP3: the frame count after an ID3v2 tag gives the duration", () => {
    expect(mp3Frame(0xfffb90c0)).toEqual({ bytes: 417, samples: 1152, sampleRate: 44100, channels: 1 });
    expect(readAudioInfo(mp3(100), "mp3")).toEqual({
      format: "mp3",
      codec: "mp3",
      channels: 1,
      sampleRate: 44100,
      duration: Math.round((100 * 1152 * 1e6) / 44100) / 1e6,
    });
  });

  test("bytes of another format give null", () => {
    expect(readAudioInfo(wav(1, 8000, 0.1), "mp3")).toBeNull();
    expect(readAudioInfo(mp3(3), "ogg")).toBeNull();
    expect(readAudioInfo(new TextEncoder().encode("not a sound"), "wav")).toBeNull();
  });
});

const CHIRP = "01J9Z6Q3R9WAV00000000000AA";

/** A temp project with one WAV sound and its record. */
function soundProject(bytes: Uint8Array, name = "chirp.wav"): string {
  const dir = tempProject();
  put(dir, `assets/${name}`, bytes);
  put(dir, "assets/rights.yaml", "licence: test\n");
  put(dir, `assets/${name}.meta.json`, writeAssetRecord(record(CHIRP, name, { kind: "audio", importer: "wav" })));
  return dir;
}

describe("the sound importers and the build", () => {
  test("the import copies the file as it is and reports the duration and the channels", async () => {
    const bytes = wav(1, 11025, 0.4);
    const dir = soundProject(bytes);
    const outcome = await importAsset(dir, "assets/chirp.wav.meta.json");
    expect(outcome.status).toBe("imported");
    expect(outcome.stamp.files).toEqual(["audio.wav"]);
    expect(outcome.stamp.report).toMatchObject({ format: "wav", channels: 1, sampleRate: 11025, duration: 0.4 });
    expect(readFileSync(join(outcome.outDir, "audio.wav")).equals(bytes)).toBe(true);
    expect((await importAsset(dir, "assets/chirp.wav.meta.json")).status).toBe("current");
  });

  test("a file whose header is not its format fails the import", async () => {
    const dir = soundProject(new TextEncoder().encode("not a sound"));
    let message = "";
    await importAsset(dir, "assets/chirp.wav.meta.json").catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });
    expect(message).toContain("is not the header of a wav file");
  });

  test("the build copies the sound to <id>.wav with the stats in the manifest record", async () => {
    const bytes = wav(1, 11025, 0.4);
    const output = await buildProject(soundProject(bytes));
    expect(output.findings.filter((item) => item.level === "error")).toEqual([]);
    expect(output.files.get(`${CHIRP}.wav`)).toEqual(bytes);
    const built = output.manifest.records.find((item) => item.id === CHIRP);
    expect(built).toMatchObject({ kind: "audio", stats: { duration: 0.4, channels: 1, sampleRate: 11025 } });
    expect(built?.files.map((file) => file.file)).toEqual([`${CHIRP}.wav`]);
  });
});
