// SPDX-License-Identifier: Apache-2.0
/**
 * The `clip` call of the lab API: a video of a time range of the take from one camera, made in the page. The lab
 * seeks each frame time, draws it and gives its picture (the capture of the labs renderer: the worker or the
 * main-thread core). WebCodecs encodes the pictures (VP9, else AV1, else VP8), and the muxer of
 * `@scenity/labs-platform/webm` writes a WebM file. Without a WebCodecs encoder, or for an MP4, MediaRecorder records a
 * canvas stream at real time. The tools (`bun run labs clip`, the review pack) and the workbench bridge call it. The
 * render pool and the browser of a tool run the same page code.
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { FrameCapture } from "@scenity/runtime-dev";
import { chooseClipPath, clipBitrate, pageClipEnv, type ClipEnv, type ClipFormat } from "./choose";
import { encodeClip, type EncodeDeps, type SourceFrame } from "./encoder";
import { pageRecordDeps, recordClip, type RecordDeps } from "./recorder";
import { muxWebm } from "@scenity/labs-platform/webm";
import { nextTick, type ShallowRef } from "vue";
import type { LabClock } from "../useLabClock";
import type { ViewHandle } from "../useLabStats";

export interface ClipRequest {
  /** The first and the last simulation time (ms). */
  readonly from: number;
  readonly to: number;
  /** The frames in each second of the video (default 12). */
  readonly fps?: number;
  /** A named camera or a view. When absent or null, the clip uses the current camera of the page. */
  readonly camera?: string | CameraView | null;
  /** The width of the video (px, default 640). The height keeps the aspect of the scene. */
  readonly width?: number;
  /** "webm" (default) or "mp4" (only MediaRecorder, in a browser that records it). */
  readonly format?: ClipFormat;
  /** One key frame in each N frames (default: one for each second of video). */
  readonly keyEvery?: number;
  /** Only this path (the tests and the fallback check). */
  readonly path?: "webcodecs" | "mediarecorder";
}

export interface ClipTimings {
  /** Wait for the scene and its assets, and draw the first frame (ms). */
  readonly readyMs: number;
  /** Seek and draw the frames (ms). */
  readonly stepMs: number;
  /** Encode (WebCodecs) or record at real time (MediaRecorder) (ms). */
  readonly encodeMs: number;
  /** Write the WebM file (ms). */
  readonly muxMs: number;
  /** The full call (ms). */
  readonly totalMs: number;
}

export interface LabClip {
  /** The video file. The bridge moves the buffer to the page. */
  readonly bytes: ArrayBuffer;
  readonly mime: string;
  readonly path: "webcodecs" | "mediarecorder";
  /** The codec: "vp9", "av1", "vp8", or the type of the recorder. */
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** The simulation times of the frames (ms). */
  readonly times: readonly number[];
  /** The length of the video (ms). */
  readonly durationMs: number;
  readonly timings: ClipTimings;
}

/** The page parts of a clip (useLabApi gives them; a test gives fakes). */
export interface ClipParts {
  /** Go to a simulation time, and let the views of the lab state at that time reach the renderer. */
  seek(ms: number): Promise<void>;
  camera(view: string | CameraView): void;
  /** Wait until the scene is ready and draws the frame of the clock (`frame()` of the lab API). */
  settle(): Promise<unknown>;
  /** A picture of the next frame, `width` px wide (the labs renderer). */
  capture(width: number): Promise<FrameCapture | null>;
  /** The clock. After the clip, the clock gets its initial time and state again. */
  readonly clock: { time(): number; running(): boolean; pause(): void; play(): void };
  readonly env?: ClipEnv;
  readonly encodeDeps?: EncodeDeps;
  readonly recordDeps?: RecordDeps;
  readonly now?: () => number;
}

/** The page parts of a clip in the lab page (useLabApi). A frame is a capture after a seek, as in the strip. */
export function labClipParts(lab: {
  readonly clock: LabClock;
  readonly take: { refresh(): void };
  readonly view: ShallowRef<ViewHandle | null>;
  camera(next: string | CameraView): void;
  frame(): Promise<unknown>;
}): ClipParts {
  const { clock } = lab;
  return {
    async seek(ms) {
      clock.seek(ms);
      lab.take.refresh();
      // The views of the lab state at the time reach the renderer in the next flush of Vue.
      await nextTick();
    },
    camera: (next) => {
      lab.camera(next);
    },
    settle: () => lab.frame(),
    capture: (width) => lab.view.value?.capture(width) ?? Promise.resolve(null),
    clock: {
      time: () => clock.simNow(),
      running: () => clock.running.value,
      pause: () => {
        clock.pause();
      },
      play: () => {
        clock.play();
      },
    },
  };
}

/** The maximum number of frames of a clip (as `bun run labs clip`). */
export const MAX_CLIP_FRAMES = 400;
const DEFAULT_FPS = 12;
const DEFAULT_WIDTH = 640;
/** The time of a drawn frame can differ from its request only by a rounding (ms). */
const TIME_SLACK_MS = 0.5;

/** The simulation times of a clip: from `from` to `to` at 1 / fps, rounded to ms (as `bun run labs clip`). */
export function clipTimes(from: number, to: number, fps: number): number[] {
  if (!(fps > 0) || !(to >= from) || !Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("clip: the range must go forward and the frame rate must be above 0.");
  }
  const step = 1000 / fps;
  const times: number[] = [];
  for (let at = from; at <= to + 0.5; at += step) times.push(Math.round(at));
  if (times.length > MAX_CLIP_FRAMES) {
    throw new Error(`clip: ${String(times.length)} frames is too many (at most ${String(MAX_CLIP_FRAMES)}).`);
  }
  return times;
}

/** A picture of the frame at a simulation time. A frame of a different time gets one more try after a full `settle`. */
async function frameAt(parts: ClipParts, at: number, width: number): Promise<SourceFrame> {
  await parts.seek(at);
  let shot = await parts.capture(width);
  const off = (item: FrameCapture | null) =>
    item?.simMs !== null && item?.simMs !== undefined && Math.abs(item.simMs - at) > TIME_SLACK_MS;
  if (off(shot)) {
    shot?.bitmap?.close();
    await parts.settle();
    shot = await parts.capture(width);
  }
  if (shot?.bitmap === null || shot?.bitmap === undefined) {
    throw new Error("clip: the scene gave no picture (no canvas, or the runtime renderer of `runtime=1`).");
  }
  if (off(shot)) throw new Error(`clip: the frame of ${String(at)} ms shows ${String(shot.simMs)} ms.`);
  return { bitmap: shot.bitmap, simMs: at };
}

/** The even size of the video from a first picture (VP9 and AV1 of 4:2:0 need even sizes). */
async function videoSize(parts: ClipParts, at: number, width: number): Promise<{ width: number; height: number }> {
  const probe = await frameAt(parts, at, width);
  const size = { width: probe.bitmap.width & ~1, height: probe.bitmap.height & ~1 };
  probe.bitmap.close();
  return size;
}

function pageEncodeDeps(): EncodeDeps {
  return { VideoEncoder, VideoFrame, now: () => performance.now() };
}

/** Make a clip of the lab (see the file comment). Then the clock gets its initial time and state again. */
export async function makeClip(parts: ClipParts, request: ClipRequest): Promise<LabClip> {
  const now = parts.now ?? (() => performance.now());
  const begin = now();
  const fps = request.fps ?? DEFAULT_FPS;
  const asked = Math.round(request.width ?? DEFAULT_WIDTH);
  if (!(asked >= 16 && asked <= 4096)) throw new Error("clip: the width must be from 16 to 4096 px.");
  const times = clipTimes(request.from, request.to, fps);
  const format = request.format ?? "webm";
  const back = parts.clock.time();
  const running = parts.clock.running();
  parts.clock.pause();
  try {
    if (request.camera !== undefined && request.camera !== null) parts.camera(request.camera);
    await parts.seek(times[0] ?? request.from);
    await parts.settle();
    const size = await videoSize(parts, times[0] ?? request.from, asked);
    const readyMs = now() - begin;
    const path = await chooseClipPath(parts.env ?? pageClipEnv(), format, { ...size, fps }, request.path);
    const step = (at: number) => frameAt(parts, at, asked);
    const durationMs = (times.length * 1000) / fps;
    if (path.kind === "none") throw new Error(`clip: ${path.reason}`);
    if (path.kind === "webcodecs") {
      const keyEvery = Math.max(1, Math.round(request.keyEvery ?? fps));
      const encoded = await encodeClip(
        step,
        { codec: path.codec, ...size, fps, times, keyEvery },
        parts.encodeDeps ?? pageEncodeDeps(),
      );
      const mark = now();
      const file = muxWebm({ codec: path.codec.webm, ...size, ...encoded });
      const muxMs = now() - mark;
      return {
        bytes: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
        mime: `video/webm;codecs=${path.codec.name === "vp9" ? "vp9" : path.codec.name === "av1" ? "av01" : "vp8"}`,
        path: "webcodecs",
        codec: path.codec.name,
        ...size,
        fps,
        times,
        durationMs,
        timings: { readyMs, stepMs: encoded.stepMs, encodeMs: encoded.encodeMs, muxMs, totalMs: now() - begin },
      };
    }
    const recorded = await recordClip(
      step,
      { mime: path.mime, ...size, fps, times, bitrate: clipBitrate(size.width, size.height, fps) },
      parts.recordDeps ?? pageRecordDeps(),
    );
    return {
      bytes: recorded.bytes,
      mime: recorded.mime,
      path: "mediarecorder",
      codec: path.mime,
      ...size,
      fps,
      times,
      durationMs,
      timings: {
        readyMs,
        stepMs: recorded.stepMs,
        encodeMs: recorded.recordMs,
        muxMs: 0,
        totalMs: now() - begin,
      },
    };
  } finally {
    await parts.seek(back);
    if (running) parts.clock.play();
  }
}
