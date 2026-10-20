// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity clip`: a WebM video of a time range of a sequence from one camera, drawn by the player of a `scenity build`
 * in headless Chromium (the page code of `scenity shot`, page/). The player clock stands; for each frame time the
 * command seeks the player, takes a screenshot that stays the same, and the encoder of encode.ts encodes it. So a clip
 * is a function of the documents and the times, as a lab clip, and it does not depend on the speed of the machine. The
 * page is a tab of the scene pool when one runs (`scenity pool`; page/tabs.ts), else of a local browser of the command.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BuildSetupError, readBuildProject } from "../build/run";
import { errorLine, type DrawnBy } from "../page/player";
import { sourceOptions, tabSource, type PlayerTab } from "../page/tabs";
import { playerBuild, playTarget, SetupError } from "../page/setup";
import { pageEncoder } from "./encode";

/** The most frames of one clip (a clip is a review of a moment, not a film). */
export const MAX_FRAMES = 900;
/** The size of a clip (the 640 px width of a lab clip at the aspect of the gallery). */
export const CLIP_SIZE = { width: 640, height: 400 } as const;

export interface ClipOptions {
  readonly dir: string;
  readonly scene?: string;
  readonly sequence?: string;
  readonly from: number;
  readonly to: number;
  /** Frames per second of the video (default 12, as a lab clip). */
  readonly fps?: number;
  readonly camera?: string;
  readonly size?: { readonly width: number; readonly height: number };
  readonly backend?: string;
  readonly tier?: string;
  readonly worker?: boolean;
  /** A key frame each N frames (default: one per second of video). */
  readonly keyEvery?: number;
  /** The video file. Default `<build>/clips/<name>--<camera>@<from>-<to>.webm`. */
  readonly out?: string;
  readonly dist?: string;
  readonly build?: boolean;
  readonly lock?: string;
  /** True: the local browser of the tool, also when the scene pool runs (page/tabs.ts). */
  readonly local?: boolean;
}

export interface ClipResult {
  readonly project: string;
  readonly scene: string;
  readonly sequence: string | null;
  readonly camera: string | null;
  readonly file: string | null;
  readonly codec: string | null;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly times: readonly number[];
  readonly bytes: number;
  readonly drawn: DrawnBy | null;
  readonly error: string | null;
  readonly passed: boolean;
}

/** The sim times of the frames from `from` to `to` (ms, whole numbers) at `fps`. */
export function clipTimes(from: number, to: number, fps: number): number[] {
  const times: number[] = [];
  for (let index = 0; ; index += 1) {
    const time = from + Math.round((index * 1000) / fps);
    if (time > to || times.length >= MAX_FRAMES) return times;
    times.push(time);
  }
}

/** The project and the target of the options, with the setup checks of a clip. */
function clipTarget(options: ClipOptions) {
  const dir = resolve(options.dir);
  let project;
  try {
    project = readBuildProject(dir);
  } catch (error) {
    if (error instanceof BuildSetupError) throw new SetupError(error.message);
    throw error;
  }
  const target = playTarget(dir, project, options);
  if (target.sequence === null) throw new SetupError("A clip needs a sequence: give --sequence.");
  const size = options.size ?? CLIP_SIZE;
  if (size.width % 2 !== 0 || size.height % 2 !== 0) throw new SetupError("The clip size needs even numbers.");
  return { dir, project, target, size };
}

/** Run `scenity clip`. `log` gets the progress lines. */
export async function runClip(
  options: ClipOptions,
  log: (text: string) => void = () => undefined,
): Promise<ClipResult> {
  const { dir, project, target, size } = clipTarget(options);
  const fps = options.fps ?? 12;
  const times = clipTimes(options.from, options.to, fps);
  const dist = options.dist === undefined ? {} : { dist: options.dist };
  const build = await playerBuild(dir, { tool: "scenity clip", build: options.build === true, ...dist }, log);
  const page = {
    ...target,
    backend: options.backend ?? "webgl",
    tier: options.tier ?? "high",
    worker: options.worker ?? true,
    ...(options.camera === undefined ? {} : { camera: options.camera }),
  };
  const name = basename(target.sequence ?? target.scene).replace(/\.(scene|sequence)\.json$/, "");
  const range = `${String(options.from)}-${String(options.to)}`;
  const file = resolve(options.out ?? join(build.out, "clips", `${name}--${options.camera ?? "scene"}@${range}.webm`));
  const base = { project: project.id, ...target, camera: options.camera ?? null, ...size, fps, times };
  const keyEvery = options.keyEvery ?? Math.max(1, Math.round(fps));
  const tabs = await tabSource({ tool: "scenity clip", log, ...sourceOptions(options) });
  let drawn: DrawnBy | null = null;
  let tab: PlayerTab | null = null;
  try {
    tab = await tabs.open({ out: build.out, dir, page, ...size });
    drawn = await tab.drawn();
    const encoder = await pageEncoder(tab, size, fps);
    log(`scenity clip: ${project.id} ${target.sequence ?? ""} ${String(times.length)} frames (${encoder.codec})`);
    for (const [index, time] of times.entries()) {
      await tab.seek(time);
      await encoder.add(new Uint8Array(await tab.shot()), (time - options.from) * 1000, index % keyEvery === 0);
    }
    const bytes = await encoder.finish(Math.round(1_000_000 / fps));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return { ...base, file, codec: encoder.codec, bytes: bytes.length, drawn, error: null, passed: true };
  } catch (error) {
    return { ...base, file: null, codec: null, bytes: 0, drawn, error: errorLine(error), passed: false };
  } finally {
    await tab?.close().catch(() => null);
    await tabs.close();
  }
}
