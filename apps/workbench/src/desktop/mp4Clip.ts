// SPDX-License-Identifier: Apache-2.0
/**
 * The MP4 of a clip in the labs app (the desktop part).
 *
 * The lab frame draws each sim time of the clip without a seek. The bridge call `indexInput` gives the frame input of
 * the page (its take, events, tunes, renderer options and the camera of the clip). `indexJob` draws that input at each
 * time (apps/editor `lab/index/renderJob.ts`). No clock moves and no URL changes. WebKit refuses more than 100
 * `history.replaceState` calls in 10 s, so 60 seeks in a few seconds fail. A lab page without these calls steps its
 * clock (seek, `frame`, `capture`). WebKit has no WebP encoder, so each frame is a JPEG (3–4 ms). The page gives each
 * JPEG with its sim time to the shell as raw bytes (`clip_mp4_frame`, no JSON, no base64). The shell writes the MP4
 * with AVAssetWriter (H.264 by VideoToolbox) and gives the file back (`clip_mp4_end`). The presentation times come
 * from the sim times, never from the wall clock. One frame goes to the shell while the next one draws.
 */
import type { ClipMp4Request } from "@scenity/workbench-host/protocol";
import { invokeRaw, invokeShell, ownBuffer, readFramed, type ShellWindow } from "./shell";

/** A call of the lab bridge in the frame of the clip. */
export type FrameCall = (call: string, args?: readonly unknown[], timeoutMs?: number) => Promise<unknown>;

/** The MP4 of a clip: the answer of the surface call (the relay sends the bytes as a picture frame). */
export interface Mp4Clip {
  readonly mime: "video/mp4";
  readonly bytes: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly codec: string;
  readonly durationMs: number;
  /** The times (ms): the steps in the page, the decode and the append of the shell, its finish, the whole clip. */
  readonly ms: Readonly<Record<string, number | null>>;
}

/** The time limit of one step of the frame (a seek, a frame, a capture) (ms). */
const STEP_TIMEOUT_MS = 20_000;

/** The times of the frames of a clip: `from` to `to` at `fps`, the last one at most `to`. */
export function clipTimes(from: number, to: number, fps: number): number[] {
  const step = 1000 / fps;
  const times: number[] = [];
  for (let index = 0; ; index += 1) {
    const at = Math.round(from + index * step);
    if (at > to) break;
    times.push(at);
  }
  return times;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberOr<T extends number | null>(value: unknown, fallback: T): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A JPEG frame of the clip and the sim time that it shows. */
interface ClipFrame {
  readonly jpeg: ArrayBuffer;
  readonly simMs: number;
}

/** How the page draws the frames of a clip: the size of the frames and one frame at a time. */
interface Drawer {
  readonly width: number;
  readonly height: number;
  draw(at: number): Promise<ClipFrame>;
}

/** The JPEG of an answer of `capture` or `indexJob`. */
function jpegOf(value: unknown, at: number): ClipFrame {
  const shot = record(value);
  if (!(shot.bytes instanceof ArrayBuffer) || shot.mime !== "image/jpeg") {
    throw new Error(`The frame gave ${String(shot.mime)}, not a JPEG: the MP4 of the shell needs the WebKit picture.`);
  }
  return { jpeg: shot.bytes, simMs: numberOr(shot.simMs, at) };
}

/**
 * The frames without a seek (`indexInput`, `indexJob`), or null for a lab page without these calls. The index draws
 * at 16:10, so the height comes from the width. An odd height (H.264 needs even sides) also gives null.
 */
async function jobDrawer(call: FrameCall, request: ClipMp4Request): Promise<Drawer | null> {
  const height = Math.round(request.width / 1.6);
  if (height % 2 !== 0) return null;
  const target = { t: request.from, ...(request.camera === null ? {} : { camera: request.camera }) };
  const base = await call("indexInput", [target], STEP_TIMEOUT_MS).catch(() => null);
  if (typeof base !== "object" || base === null) return null;
  return {
    width: request.width,
    height,
    draw: async (at) =>
      jpegOf(await whenReady(() => call("indexJob", [{ ...base, timeMs: at }, request.width], STEP_TIMEOUT_MS)), at),
  };
}

/** The wait of a frame for a scene that loads (a new take loads its characters) (ms). */
const READY_WAIT_MS = 20_000;

/** Run a draw again while the scene of the page loads ("not ready"), up to READY_WAIT_MS. */
async function whenReady(draw: () => Promise<unknown>): Promise<unknown> {
  const end = performance.now() + READY_WAIT_MS;
  for (;;) {
    try {
      return await draw();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!text.includes("not ready") || performance.now() > end) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/** The frames of a lab page without `indexJob`: stop the clock at each time, draw it, capture it. */
function seekDrawer(call: FrameCall, request: ClipMp4Request): Drawer {
  return {
    width: request.width,
    height: request.height,
    async draw(at) {
      await call("seek", [at], STEP_TIMEOUT_MS);
      await call("frame", [], STEP_TIMEOUT_MS);
      return jpegOf(await call("capture", [request.width, null, request.height], STEP_TIMEOUT_MS), at);
    },
  };
}

/** Make the MP4 of a clip of the lab frame with the shell. */
export async function makeMp4Clip(
  call: FrameCall,
  request: ClipMp4Request,
  options: { readonly win?: ShellWindow; readonly now?: () => number } = {},
): Promise<Mp4Clip> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  await call("pause");
  if (request.take !== null) await call("load", [request.take]);
  if (request.camera !== null) await call("camera", [request.camera]);
  const times = clipTimes(request.from, request.to, request.fps);
  const drawer = (await jobDrawer(call, request)) ?? seekDrawer(call, request);
  const size = { width: drawer.width, height: drawer.height, fps: request.fps };
  const session = await invokeShell("clip_mp4_begin", { request: size }, options.win);
  if (typeof session !== "number") throw new Error("The shell started no MP4.");
  let step = 0;
  let last = Number.NEGATIVE_INFINITY;
  let first: number | null = null;
  let sending: Promise<unknown> = Promise.resolve();
  try {
    for (const at of times) {
      const begin = now();
      const frame = await drawer.draw(at);
      step += now() - begin;
      // A frame of the same sim time as the one before adds nothing (the clock had not moved).
      if (frame.simMs <= last) continue;
      last = frame.simMs;
      first ??= frame.simMs;
      await sending;
      const headers = { "x-clip-session": String(session), "x-sim-ms": String(frame.simMs) };
      sending = invokeRaw("clip_mp4_frame", frame.jpeg, headers, options.win);
    }
    await sending;
  } catch (error) {
    await invokeShell("clip_mp4_end", { session }, options.win).catch(() => null);
    throw error;
  }
  const { header, bytes } = readFramed(await invokeShell("clip_mp4_end", { session }, options.win));
  const shell = record(header.ms);
  return {
    mime: "video/mp4",
    bytes: ownBuffer(bytes),
    width: numberOr(header.width, drawer.width),
    height: numberOr(header.height, drawer.height),
    frames: numberOr(header.frames, 0),
    codec: typeof header.codec === "string" ? header.codec : "avc1",
    durationMs: first === null ? 0 : last - first,
    ms: {
      step,
      decode: numberOr(shell.decode, null),
      append: numberOr(shell.append, null),
      finish: numberOr(shell.finish, null),
      total: now() - start,
    },
  };
}
