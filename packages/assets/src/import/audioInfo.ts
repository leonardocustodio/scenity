// SPDX-License-Identifier: Apache-2.0
/**
 * The header read of a sound file: the format, the channels, the sample rate and the duration of a WAV, an
 * Ogg (Vorbis or Opus) or an MP3 file. The read decodes no samples. A file that does not match its format gives null.
 *
 * - WAV: the `fmt ` chunk gives the channels, the rate and the bytes per second; the `data` chunk gives the length.
 * - Ogg: the first packet (the Vorbis or the Opus head) gives the channels and the rate; the granule position of the
 *   last page gives the length (Opus counts at 48 kHz, less the pre-skip).
 * - MP3: the frames after an ID3v2 tag: the first frame gives the channels and the rate; the duration is the count
 *   of the frames times the samples of a frame.
 */

export type AudioFormat = "wav" | "ogg" | "mp3";

export interface AudioInfo {
  readonly format: AudioFormat;
  /** The codec in the file: `pcm`, `float`, `vorbis`, `opus` or `mp3`. */
  readonly codec: string;
  readonly channels: number;
  readonly sampleRate: number;
  /** The length of the sound in seconds (rounded to 1 µs). */
  readonly duration: number;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function seconds(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function wavInfo(bytes: Uint8Array, view: DataView): AudioInfo | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  let format: { codec: string; channels: number; sampleRate: number; byteRate: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 24 <= bytes.length) {
      const tag = view.getUint16(at + 8, true);
      const codec = tag === 3 ? "float" : tag === 1 || tag === 0xfffe ? "pcm" : `wav-${String(tag)}`;
      const channels = view.getUint16(at + 10, true);
      format = { codec, channels, sampleRate: view.getUint32(at + 12, true), byteRate: view.getUint32(at + 16, true) };
    } else if (id === "data" && format !== null && format.byteRate > 0) {
      const length = Math.min(size, bytes.length - at - 8);
      const duration = seconds(length / format.byteRate);
      return { format: "wav", codec: format.codec, channels: format.channels, sampleRate: format.sampleRate, duration };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The head of an Ogg stream: the codec, the channels, the rate and the samples to skip at the start. */
function oggHead(bytes: Uint8Array, view: DataView) {
  const segments = bytes[26] ?? 0;
  const at = 27 + segments;
  if (ascii(bytes, at, 7) === "\u0001vorbis" && at + 16 <= bytes.length) {
    return { codec: "vorbis", channels: bytes[at + 11] ?? 0, sampleRate: view.getUint32(at + 12, true), skip: 0 };
  }
  if (ascii(bytes, at, 8) === "OpusHead" && at + 16 <= bytes.length) {
    const skip = view.getUint16(at + 10, true);
    return { codec: "opus", channels: bytes[at + 9] ?? 0, sampleRate: view.getUint32(at + 12, true), skip };
  }
  return null;
}

function oggInfo(bytes: Uint8Array, view: DataView): AudioInfo | null {
  if (bytes.length < 28 || ascii(bytes, 0, 4) !== "OggS") return null;
  const head = oggHead(bytes, view);
  if (head === null) return null;
  let last = -1;
  for (let at = bytes.length - 27; at >= 0; at -= 1) {
    if (bytes[at] === 0x4f && ascii(bytes, at, 4) === "OggS") {
      last = at;
      break;
    }
  }
  if (last < 0) return null;
  const granule = Number(view.getBigUint64(last + 6, true));
  // Opus counts the granule position at 48 kHz for each input rate.
  const rate = head.codec === "opus" ? 48000 : head.sampleRate;
  const duration = rate > 0 ? seconds(Math.max(0, granule - head.skip) / rate) : 0;
  return { format: "ogg", codec: head.codec, channels: head.channels, sampleRate: head.sampleRate, duration };
}

const BITRATES: Readonly<Record<string, readonly number[]>> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Readonly<Record<number, readonly number[]>> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  2.5: [11025, 12000, 8000],
};

/** One MP3 frame header: its length in bytes, its samples, its rate and its channels; null for no frame. */
export function mp3Frame(header: number) {
  if (header >>> 21 !== 0x7ff) return null;
  const version = [2.5, 0, 2, 1][(header >>> 19) & 3] ?? 0;
  const layer = [0, 3, 2, 1][(header >>> 17) & 3] ?? 0;
  const kbps = BITRATES[`${version === 1 ? "1" : "2"}-${String(layer)}`]?.[(header >>> 12) & 15] ?? 0;
  const sampleRate = RATES[version]?.[(header >>> 10) & 3] ?? 0;
  if (version === 0 || layer === 0 || kbps === 0 || sampleRate === 0) return null;
  const padding = (header >>> 9) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const bytes =
    layer === 1
      ? (Math.floor((12000 * kbps) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * 1000 * kbps) / sampleRate) + padding;
  return { bytes, samples, sampleRate, channels: ((header >>> 6) & 3) === 3 ? 1 : 2 };
}

/** The offset of the first byte after an ID3v2 tag at the start, or 0. */
function id3End(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return 0;
  const size = ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
  return 10 + size + ((bytes[5] ?? 0) & 0x10 ? 10 : 0);
}

function mp3Info(bytes: Uint8Array, view: DataView): AudioInfo | null {
  let at = id3End(bytes);
  let first: ReturnType<typeof mp3Frame> = null;
  let samples = 0;
  while (at + 4 <= bytes.length) {
    const frame = mp3Frame(view.getUint32(at, false));
    if (frame === null || at + frame.bytes > bytes.length) break;
    first ??= frame;
    samples += frame.samples;
    at += frame.bytes;
  }
  if (first === null) return null;
  const duration = seconds(samples / first.sampleRate);
  return { format: "mp3", codec: "mp3", channels: first.channels, sampleRate: first.sampleRate, duration };
}

/** The header facts of a sound file of a format, or null when the bytes are not a file of that format. */
export function readAudioInfo(bytes: Uint8Array, format: AudioFormat): AudioInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "wav") return wavInfo(bytes, view);
  if (format === "ogg") return oggInfo(bytes, view);
  return mp3Info(bytes, view);
}
