// SPDX-License-Identifier: Apache-2.0
/**
 * The WebCodecs encoder of a clip. It encodes the frames of the lab at the times of the clip as `VideoFrame`s with
 * VP9, AV1 or VP8, and gives frames for the WebM muxer. The times of the frames come from the simulation times of the
 * clip, never from the wall clock. Thus the same clip always gives the same timestamps.
 *
 * The frames go in batches. The lab draws the frames of a batch (the step time), then the encoder encodes them (the
 * encode time). Thus the two times are separate, and a batch holds at most BATCH_BYTES of pictures.
 */
import { encoderConfig, type ClipCodec } from "./choose";
import type { MuxFrame } from "@scenity/labs-platform/webm";

/** A picture of the lab at a simulation time. The encoder closes the bitmap. */
export interface SourceFrame {
  readonly bitmap: ImageBitmap;
  readonly simMs: number;
}

/** The parts of WebCodecs that the encoder uses (a test gives fakes) and a clock for the timings. */
export interface EncodeDeps {
  readonly VideoEncoder: new (init: VideoEncoderInit) => Pick<VideoEncoder, "configure" | "encode" | "flush" | "close">;
  readonly VideoFrame: new (image: ImageBitmap, init: VideoFrameInit) => Pick<VideoFrame, "close">;
  readonly now: () => number;
}

export interface EncodeRequest {
  readonly codec: ClipCodec;
  /** The size of the video (even numbers). The encoder cuts the frames to this size from their top left corner. */
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** The simulation times of the frames (ms). The first time is time 0 of the video. */
  readonly times: readonly number[];
  /** One key frame in each `keyEvery` frames (the first frame is always a key frame). */
  readonly keyEvery: number;
}

export interface EncodedClip {
  readonly frames: readonly MuxFrame[];
  /** The time of one frame in the video (µs). */
  readonly frameUs: number;
  readonly codecPrivate: Uint8Array | null;
  /** The time to seek and draw the frames (ms). */
  readonly stepMs: number;
  /** The time to make the video frames and encode them (ms). */
  readonly encodeMs: number;
}

/** The maximum bytes of RGBA pictures in one batch (256 MB: 65 frames at 1280×800, 262 at 640×400). */
export const BATCH_BYTES = 256 * 1024 * 1024;

/** The time of a frame in the video (µs): its simulation time minus the time of the first frame of the clip. */
export function timestampUs(simMs: number, firstMs: number): number {
  return Math.round((simMs - firstMs) * 1000);
}

/** The number of frames in one batch. */
export function batchSize(width: number, height: number): number {
  return Math.max(1, Math.floor(BATCH_BYTES / (width * height * 4)));
}

/**
 * The `av1C` record of an AV1 codec string (`av01.P.LLT.DD`), for an encoder that gives no description. The WebM
 * track of AV1 needs it. The values are the profile, the level, the tier and the bit depth, with 4:2:0 chroma.
 */
export function av1cOf(codec: string): Uint8Array {
  const match = /^av01\.(\d)\.(\d\d)([MH])\.(\d\d)/.exec(codec);
  if (match === null) throw new Error(`No AV1 codec string: ${codec}.`);
  const profile = Number(match[1]);
  const level = Number(match[2]);
  const high = match[3] === "H" ? 1 : 0;
  const depth = Number(match[4]);
  const highBitDepth = depth > 8 ? 1 : 0;
  const twelve = depth === 12 ? 1 : 0;
  return Uint8Array.from([
    0x81,
    ((profile & 0x7) << 5) | (level & 0x1f),
    (high << 7) | (highBitDepth << 6) | (twelve << 5) | (0 << 4) | (1 << 3) | (1 << 2),
    0,
  ]);
}

/** Encode the frames that `step` gives at the times of the request. */
export async function encodeClip(
  step: (simMs: number) => Promise<SourceFrame>,
  request: EncodeRequest,
  deps: EncodeDeps,
): Promise<EncodedClip> {
  const first = request.times[0] ?? 0;
  const frameUs = Math.round(1_000_000 / request.fps);
  const frames: MuxFrame[] = [];
  // The callbacks of the encoder write these.
  const got: { codecPrivate: Uint8Array | null; failure: Error | null } = { codecPrivate: null, failure: null };
  const encoder = new deps.VideoEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, timestampUs: chunk.timestamp, key: chunk.type === "key" });
      const description = metadata?.decoderConfig?.description;
      if (got.codecPrivate === null && description !== undefined) got.codecPrivate = bytesOf(description);
    },
    error(error) {
      got.failure = error;
    },
  });
  encoder.configure(encoderConfig(request.codec, request.width, request.height, request.fps));
  const size = batchSize(request.width, request.height);
  let stepMs = 0;
  let encodeMs = 0;
  try {
    for (let start = 0; start < request.times.length; start += size) {
      const times = request.times.slice(start, start + size);
      let mark = deps.now();
      const shots: SourceFrame[] = [];
      for (const at of times) shots.push(await step(at));
      stepMs += deps.now() - mark;
      mark = deps.now();
      shots.forEach((shot, index) => {
        const frame = new deps.VideoFrame(shot.bitmap, {
          timestamp: timestampUs(shot.simMs, first),
          duration: frameUs,
          visibleRect: { x: 0, y: 0, width: request.width, height: request.height },
        });
        shot.bitmap.close();
        encoder.encode(frame as VideoFrame, { keyFrame: (start + index) % request.keyEvery === 0 });
        frame.close();
      });
      await encoder.flush();
      encodeMs += deps.now() - mark;
      if (got.failure !== null) throw got.failure;
    }
  } finally {
    encoder.close();
  }
  const codecPrivate = got.codecPrivate ?? (request.codec.name === "av1" ? av1cOf(request.codec.codec) : null);
  return { frames, frameUs, codecPrivate, stepMs, encodeMs };
}

function bytesOf(source: AllowSharedBufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  const view = source as ArrayBufferView;
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}
