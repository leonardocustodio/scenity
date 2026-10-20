// SPDX-License-Identifier: Apache-2.0
/**
 * The clips of the lab tools: `bun run labs clip` and the clip of the review pack. The page makes the video
 * (`__room3dLab.clip`, src/core/clip/labClip.ts: WebCodecs VP9 or AV1 in WebM, or MediaRecorder). The page is a page
 * of the render pool or the page of the browser of the tool. Both run the same page code. The WebP path is the last
 * fallback and the path of `--format webp`: a shot per frame, a WebP per shot in the page, and one animated WebP file
 * (webpAnim.ts).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CameraView } from "@scenity/runtime/framing";
import type { ClipFormat } from "../../src/core/clip/choose";
import type { ClipRequest, ClipTimings } from "../../src/core/clip/labClip";
import type { LabShooter, Shot } from "./shooter";
import { animatedWebp } from "./webpAnim";

/** A clip that the page made. */
export interface PageClip {
  readonly bytes: Buffer;
  readonly mime: string;
  /** The file extension: "webm" or "mp4". */
  readonly extension: string;
  readonly path: string;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly durationMs: number;
  readonly timings: ClipTimings;
}

/** The format of `labs clip --format`: a video of the page, or an animated WebP. Null for another text. */
export function clipFormat(text: string): ClipFormat | "webp" | null {
  return text === "webm" || text === "mp4" || text === "webp" ? text : null;
}

/** The extension of a video type. */
export function extensionOf(mime: string): string {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

/** Make a clip in the page (`__room3dLab.clip`). The bytes return as base64, because the pool answers JSON. */
export async function pageClip(shooter: LabShooter, request: ClipRequest): Promise<PageClip> {
  const made = await shooter.page.evaluate(async (asked) => {
    const lab = globalThis.__room3dLab;
    if (lab === undefined) throw new Error("The lab API is not on the page.");
    if (typeof lab.clip !== "function") throw new Error("The lab of this page has no clip call.");
    const { bytes, ...rest } = await lab.clip(asked);
    const view = new Uint8Array(bytes);
    let text = "";
    for (let at = 0; at < view.length; at += 0x8000) {
      text += String.fromCharCode(...view.subarray(at, at + 0x8000));
    }
    return { ...rest, data: btoa(text) };
  }, request);
  return {
    bytes: Buffer.from(made.data, "base64"),
    mime: made.mime,
    extension: extensionOf(made.mime),
    path: made.path,
    codec: made.codec,
    width: made.width,
    height: made.height,
    frames: made.times.length,
    durationMs: made.durationMs,
    timings: made.timings,
  };
}

/** The WebP clip: a shot per time, a WebP of each in the page, one animated WebP. With the time of the work. */
export async function webpClip(
  shooter: LabShooter,
  times: readonly number[],
  camera: string | CameraView,
  width: number,
  fps: number,
  each?: (shot: Shot) => void,
): Promise<{ bytes: Uint8Array; ms: number }> {
  const start = performance.now();
  const frames: Uint8Array[] = [];
  let size = { width, height: width };
  for (const at of times) {
    const done = await shooter.shot(at, camera);
    const encoded = await shooter.webp(done.png, width);
    frames.push(encoded.bytes);
    size = { width: encoded.width, height: encoded.height };
    each?.(done);
  }
  const bytes = animatedWebp(frames, size, 1000 / fps);
  return { bytes, ms: performance.now() - start };
}

/** A size in KB or MB for a summary. */
export function sizeText(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${String(Math.round(bytes / 1000))} KB`;
}

/** The summary of a page clip: codec, size, bytes and the timings. */
export function clipSummary(clip: PageClip): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  const { readyMs, stepMs, encodeMs, muxMs, totalMs } = clip.timings;
  const encode = clip.path === "webcodecs" ? "encode" : "record (real time)";
  return (
    `${clip.codec} ${String(clip.width)}×${String(clip.height)}, ${sizeText(clip.bytes.length)}; ` +
    `ready ${seconds(readyMs)}, step ${seconds(stepMs)}, ${encode} ${seconds(encodeMs)}, ` +
    `mux ${String(Math.round(muxMs))} ms, in the page ${seconds(totalMs)}`
  );
}

/** The clip of the review pack: from 2 s before the key moment to 2 s after it, chest camera. */
export const REVIEW_CLIP = { before: 2_000, after: 2_000, fps: 10, width: 480, camera: "chest" } as const;

/**
 * The clip of the review pack around `key`: `clip<suffix>.webm` from the page with a WebP still of the key moment as
 * its poster (`clip<suffix>-poster.webp`). When the page cannot make a video, the clip is the animated WebP
 * (`clip<suffix>.webp`). Gives the file name of the clip.
 */
export async function reviewClip(shooter: LabShooter, key: number, folder: string, suffix: string): Promise<string> {
  const from = Math.max(0, key - REVIEW_CLIP.before);
  const to = key + REVIEW_CLIP.after;
  const { fps, width, camera } = REVIEW_CLIP;
  try {
    const clip = await pageClip(shooter, { from, to, fps, camera, width, format: "webm" });
    const file = `clip${suffix}.${clip.extension}`;
    writeFileSync(join(folder, file), clip.bytes);
    const still = await shooter.shot(key, camera);
    writeFileSync(join(folder, `clip${suffix}-poster.webp`), (await shooter.webp(still.png, width)).bytes);
    return file;
  } catch (error) {
    console.error(`room3d: the page made no video (${String(error)}); the clip is an animated WebP`);
    const times: number[] = [];
    for (let at = from; at <= to; at += 1000 / fps) times.push(Math.round(at));
    const file = `clip${suffix}.webp`;
    writeFileSync(join(folder, file), (await webpClip(shooter, times, camera, width, fps)).bytes);
    return file;
  }
}

/** The lines of REVIEW.md for the clip in `folder`: a video with its poster, or the animated WebP. */
export function clipMarkdown(folder: string): string[] {
  const video = ["clip.webm", "clip.mp4"].find((name) => existsSync(join(folder, name)));
  if (video === undefined) return ["The motion around it (chest camera): [clip.webp](clip.webp)"];
  return [
    `The motion around it (chest camera): [${video}](${video})`,
    "",
    `<video src="${video}" poster="clip-poster.webp" width="${String(REVIEW_CLIP.width)}" controls loop muted playsinline></video>`,
  ];
}
