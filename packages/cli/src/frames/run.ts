// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity frames`: the frame index of a project (frameIndex.ts). The command draws each frame of the project that has
 * no picture, with the player of a `scenity build` in headless Chromium (the tabs of `scenity shot`, page/tabs.ts; the
 * tabs of the scene pool when one runs). One tab draws each plan and camera, and seeks each time of a sequence. The
 * pictures are PNG files of `.scenity/frames/`; the list keeps two pictures of each place, and the command deletes a
 * picture that the list drops.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildSetupError, readBuildProject } from "../build/run";
import { errorLine } from "../page/player";
import { playerBuild, playTarget, SetupError } from "../page/setup";
import { sourceOptions, tabSource } from "../page/tabs";
import type { PlayerSpec } from "../pool/target";
import {
  FRAMES_FOLDER,
  mergeFrames,
  projectContentHash,
  projectDocuments,
  readFrameIndex,
  wantedFrames,
  writeFrameIndex,
  type IndexedFrame,
  type WantedFrame,
} from "./frameIndex";

/** The size of a picture of the index (the player draws at this size). */
export const FRAME_SIZE = { width: 480, height: 300 } as const;

export interface FramesOptions {
  readonly dir: string;
  /** A time each `step` ms of each sequence, beside its moments (0: the moments only). */
  readonly step?: number;
  readonly size?: { readonly width: number; readonly height: number };
  readonly backend?: string;
  readonly dist?: string;
  readonly build?: boolean;
  readonly lock?: string;
  readonly local?: boolean;
}

export interface FramesResult {
  readonly project: string;
  /** The current frames of the project. */
  readonly frames: number;
  /** The frames that this run drew. */
  readonly drawn: number;
  /** The frames in the list (with the pictures before a change). */
  readonly listed: number;
  readonly error: string | null;
  readonly passed: boolean;
}

/** The frames to draw, by their plan and camera (one tab each). */
function groups(frames: readonly WantedFrame[]): WantedFrame[][] {
  const byTab = new Map<string, WantedFrame[]>();
  for (const frame of frames) {
    const id = `${frame.plan}|${frame.camera ?? ""}`;
    byTab.set(id, [...(byTab.get(id) ?? []), frame]);
  }
  return [...byTab.values()];
}

/** Run `scenity frames`. `log` gets the progress lines. */
export async function runFrames(options: FramesOptions, log: (text: string) => void = () => undefined) {
  const dir = resolve(options.dir);
  let project;
  try {
    project = readBuildProject(dir);
  } catch (error) {
    if (error instanceof BuildSetupError) throw new SetupError(error.message);
    throw error;
  }
  const docs = projectDocuments(dir);
  const wanted = wantedFrames(docs.project, docs.files, projectContentHash(dir, docs.project), options.step ?? 0);
  const old = readFrameIndex(dir).frames;
  const have = new Set(
    old.filter((frame) => existsSync(join(dir, FRAMES_FOLDER, `${frame.key}.png`))).map((f) => f.key),
  );
  const todo = wanted.filter((frame) => !have.has(frame.key));
  const added: IndexedFrame[] = [];
  let error: string | null = null;
  if (todo.length > 0) {
    const dist = options.dist === undefined ? {} : { dist: options.dist };
    const build = await playerBuild(dir, { tool: "scenity frames", build: options.build === true, ...dist }, log);
    const size = options.size ?? FRAME_SIZE;
    const tabs = await tabSource({ tool: "scenity frames", log, ...sourceOptions(options) });
    mkdirSync(join(dir, FRAMES_FOLDER), { recursive: true });
    try {
      for (const group of groups(todo)) {
        const first = group[0];
        if (first === undefined) continue;
        const target = playTarget(dir, project, {
          scene: first.scene,
          ...(first.sequence ? { sequence: first.sequence } : {}),
        });
        const page = { ...target, backend: options.backend ?? "webgl", tier: "high", worker: true };
        const spec: PlayerSpec = {
          out: build.out,
          dir,
          page: first.camera === null ? page : { ...page, camera: first.camera },
          ...size,
        };
        log(`scenity frames: ${first.plan} camera ${first.camera ?? "of the scene"}: ${String(group.length)} frames`);
        const tab = await tabs.open(spec);
        try {
          for (const frame of group) {
            if (frame.sequence !== null) await tab.seek(frame.time);
            writeFileSync(join(dir, FRAMES_FOLDER, `${frame.key}.png`), new Uint8Array(await tab.shot()));
            added.push({ ...frame, made: new Date().toISOString() });
          }
        } finally {
          await tab.close();
        }
      }
    } catch (failure) {
      error = errorLine(failure);
    } finally {
      await tabs.close();
    }
  }
  const listed = mergeFrames(old, added);
  const kept = new Set(listed.map((frame) => frame.key));
  for (const frame of old)
    if (!kept.has(frame.key)) rmSync(join(dir, FRAMES_FOLDER, `${frame.key}.png`), { force: true });
  writeFrameIndex(dir, listed);
  const result: FramesResult = {
    project: project.id,
    frames: wanted.length,
    drawn: added.length,
    listed: listed.length,
    error,
    passed: error === null,
  };
  return result;
}
