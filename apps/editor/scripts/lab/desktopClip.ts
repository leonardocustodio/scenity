// SPDX-License-Identifier: Apache-2.0
/**
 * The MP4 of `labs clip --format mp4` in the labs app.
 *
 * A tool that runs in the workbench (the Claude terminal, a run) has the host of the app in its environment
 * (`SCENITY_WORKBENCH_ORIGIN`, `SCENITY_WORKBENCH_TOKEN`). It asks the host for the clip (`POST /clips/mp4`). The lab
 * frame of the app draws each frame as a JPEG and the shell writes the MP4 with VideoToolbox. That takes about 1.2 s
 * for 60 frames, in place of the real time of MediaRecorder. The host keeps the file in its picture store, and the tool
 * reads it at `GET /pictures/<id>`. Without the app (no host, a browser page: 501) the answer is null. Then the tool
 * makes the clip in its own page (MediaRecorder: the browser path).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { envValue } from "@scenity/labs-platform/envNames";

/** The request of the clip: the take, the range (ms), the rate, the camera and the width (16:10). */
export interface DesktopClipRequest {
  readonly take: string;
  readonly from: number;
  readonly to: number;
  readonly fps: number;
  readonly camera: string;
  readonly width: number;
}

/** The MP4 and the answer of the host (frames, size, times). */
export interface DesktopClip {
  readonly bytes: Buffer;
  readonly answer: Record<string, unknown>;
  readonly ms: number;
}

/** An even width from 16 to 4096 px whose 16:10 height is even too (a multiple of 16). */
export function clipWidth(width: number): number {
  return Math.min(4096, Math.max(16, Math.round(width / 16) * 16));
}

/** The MP4 of the labs app, or null without the app (the tool then makes the clip in its own page). */
export async function desktopMp4(
  request: DesktopClipRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DesktopClip | null> {
  const origin = envValue("SCENITY_WORKBENCH_ORIGIN", env);
  const token = envValue("SCENITY_WORKBENCH_TOKEN", env);
  if (origin === undefined || token === undefined || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return null;
  const headers = { "content-type": "application/json", "x-workbench-token": token };
  const width = clipWidth(request.width);
  const body = { ...request, width, height: Math.round(width / 1.6) };
  const started = performance.now();
  const response = await fetch(`${origin}/clips/mp4`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(200_000),
  }).catch(() => null);
  // No host, or a page without the MP4 writer of the shell (501): the browser path.
  if (response === null || response.status === 501 || response.status === 404) return null;
  if (!response.ok) throw new Error(`the MP4 of the labs app failed: ${await response.text()}`);
  const answer = (await response.json()) as Record<string, unknown>;
  const id = typeof answer.id === "string" ? answer.id : "";
  const file = await fetch(`${origin}/pictures/${id}`, { headers: { "x-workbench-token": token } });
  if (!file.ok) throw new Error(`the host has no MP4 ${id}`);
  return { bytes: Buffer.from(await file.arrayBuffer()), answer, ms: performance.now() - started };
}

/**
 * `labs clip --format mp4` in the labs app: write `clip.mp4` of the shell into the folder and print its line. False
 * without the app, or after an error (the tool then makes the clip in its own page).
 */
export async function desktopClipTo(
  folder: string,
  run: {
    readonly take: string;
    readonly times: readonly number[];
    readonly fps: number;
    readonly camera: string;
    readonly width: number;
  },
): Promise<boolean> {
  const request = {
    take: run.take,
    from: run.times[0] ?? 0,
    to: run.times.at(-1) ?? 0,
    fps: run.fps,
    camera: run.camera,
    width: run.width,
  };
  const made = await desktopMp4(request).catch((error: unknown) => {
    console.error(`room3d: ${String(error)}; the clip comes from the page`);
    return null;
  });
  if (made === null) return false;
  const file = join(folder, "clip.mp4");
  writeFileSync(file, made.bytes);
  const { frames, width, height, codec } = made.answer;
  console.log(
    `${file}  ${String(codec)} ${String(width)}×${String(height)}, ${String(frames)} frames, ` +
      `${String(Math.round(made.bytes.length / 1000))} KB; the labs app in ${(made.ms / 1000).toFixed(2)} s`,
  );
  return true;
}
