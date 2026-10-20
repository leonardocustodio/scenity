// SPDX-License-Identifier: Apache-2.0
/**
 * The path of a clip. The first choice is WebCodecs in the page (VP9 first, AV1 second, VP8 last) into WebM. The second
 * choice is MediaRecorder on a canvas stream at real time. Else there is no path, and the tool makes an animated WebP.
 * H.264 in WebCodecs stops in WebKit, so no path asks for it. An MP4 comes only from MediaRecorder, in a browser that
 * records `video/mp4` (Safari, WebKit).
 */
import { CLIP_CODECS } from "@scenity/labs-platform";
import type { WebmCodec } from "@scenity/labs-platform/webm";

/** The container of a clip: WebM (the default) or MP4 (to share; MediaRecorder only). */
export type ClipFormat = "webm" | "mp4";

/** A WebCodecs codec of a clip: its codec string and its WebM codec ID. */
export interface ClipCodec {
  readonly name: "vp9" | "av1" | "vp8";
  readonly codec: string;
  readonly webm: WebmCodec;
}

/** The WebCodecs codecs in their order of choice. */
export const CLIP_CODEC_ORDER: readonly ClipCodec[] = [
  { name: "vp9", codec: CLIP_CODECS.vp9, webm: "V_VP9" },
  { name: "av1", codec: CLIP_CODECS.av1, webm: "V_AV1" },
  { name: "vp8", codec: "vp8", webm: "V_VP8" },
];

/** The MediaRecorder types of each container, in their order of choice. */
export const RECORDER_TYPES: Readonly<Record<ClipFormat, readonly string[]>> = {
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  mp4: ["video/mp4;codecs=avc1", "video/mp4"],
};

export type ClipPath =
  | { readonly kind: "webcodecs"; readonly codec: ClipCodec }
  | { readonly kind: "mediarecorder"; readonly mime: string }
  | { readonly kind: "none"; readonly reason: string };

/** The parts of the page that the choice reads (a test gives fakes). */
export interface ClipEnv {
  readonly VideoEncoder?: Pick<typeof VideoEncoder, "isConfigSupported">;
  readonly MediaRecorder?: Pick<typeof MediaRecorder, "isTypeSupported">;
  /** A canvas element of the page has `captureStream` (the MediaRecorder path draws to one). */
  readonly captureStream: boolean;
}

/** The parts of the global scope of the page. */
export function pageClipEnv(scope: typeof globalThis = globalThis): ClipEnv {
  const canvas = (scope as { HTMLCanvasElement?: typeof HTMLCanvasElement }).HTMLCanvasElement;
  return {
    ...(typeof scope.VideoEncoder === "function" ? { VideoEncoder: scope.VideoEncoder } : {}),
    ...(typeof scope.MediaRecorder === "function" ? { MediaRecorder: scope.MediaRecorder } : {}),
    captureStream: canvas !== undefined && typeof canvas.prototype.captureStream === "function",
  };
}

/** The encoder settings of a clip of this size and frame rate. */
export function encoderConfig(codec: ClipCodec, width: number, height: number, fps: number): VideoEncoderConfig {
  return {
    codec: codec.codec,
    width,
    height,
    framerate: fps,
    bitrate: clipBitrate(width, height, fps),
    bitrateMode: "variable",
    latencyMode: "quality",
  };
}

/** Approximately 0.25 bit for each pixel and frame, from 0.5 to 12 Mbit/s. This is sufficient to review the hands. */
export function clipBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(12_000_000, Math.max(500_000, width * height * fps * 0.25)));
}

async function supported(env: ClipEnv, codec: ClipCodec, size: ClipSize): Promise<boolean> {
  const encoder = env.VideoEncoder;
  if (encoder === undefined) return false;
  try {
    const answer = await encoder.isConfigSupported(encoderConfig(codec, size.width, size.height, size.fps));
    return answer.supported === true;
  } catch {
    return false;
  }
}

function recorderType(env: ClipEnv, format: ClipFormat): string | null {
  const recorder = env.MediaRecorder;
  if (recorder === undefined || !env.captureStream) return null;
  return RECORDER_TYPES[format].find((type) => recorder.isTypeSupported(type)) ?? null;
}

export interface ClipSize {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

/**
 * Choose the path of a clip. `force` permits only one path (the tests and the fallback check): "webcodecs" or
 * "mediarecorder".
 */
export async function chooseClipPath(
  env: ClipEnv,
  format: ClipFormat,
  size: ClipSize,
  force?: "webcodecs" | "mediarecorder",
): Promise<ClipPath> {
  if (format === "webm" && force !== "mediarecorder") {
    for (const codec of CLIP_CODEC_ORDER) if (await supported(env, codec, size)) return { kind: "webcodecs", codec };
    if (force === "webcodecs") return { kind: "none", reason: "WebCodecs encodes no VP9, AV1 or VP8 here." };
  }
  if (format === "mp4" && force === "webcodecs") {
    return { kind: "none", reason: "An MP4 comes only from MediaRecorder (no H.264 in WebCodecs)." };
  }
  const mime = recorderType(env, format);
  if (mime !== null) return { kind: "mediarecorder", mime };
  return {
    kind: "none",
    reason:
      format === "mp4"
        ? "This browser records no video/mp4 (MediaRecorder); use WebM."
        : "This browser has no WebCodecs encoder and no MediaRecorder of a canvas stream.",
  };
}
