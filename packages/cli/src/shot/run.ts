// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity shot`: one picture of a scene of a project, or of a sequence at a time, in the player of a `scenity build`
 * in headless Chromium. It uses the page code of `scenity bench` (page/): the build folder, the page server, the
 * browser and the GPU lock of the labs tools. The page is a tab of the scene pool when one runs (`scenity pool`;
 * page/tabs.ts), else of a local browser of the command.
 *
 * The picture follows the gallery of the editor (apps/editor/tests/gallery/showroom.spec.ts and player.spec.ts): a
 * viewport of 1280 × 800 at the device scale 1, the tier "high", WebGL in the render worker, a wait for the first
 * frame with every asset (`data-state="ready"` of the player), and then screenshots of the player element until two
 * screenshots in sequence are equal. The player draws the same frame as the scene page, so a tool can compare the
 * picture with the baselines of the scene page. The page has no adaptive quality ladder, no poster and a stopped clock.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BuildSetupError, readBuildProject } from "../build/run";
import { errorLine } from "../page/player";
import { sourceOptions, tabSource, type PlayerTab, type TabSource } from "../page/tabs";
import type { PlayerSpec } from "../pool/target";
import { playerBuild, playTarget, SetupError } from "../page/setup";
import { comparePng, GALLERY_TOLERANCE, type Comparison } from "./compare";

export const SHOT_TIERS = ["ultra", "high", "medium", "low"] as const;
export const SHOT_BACKENDS = ["webgl", "webgpu"] as const;
/** The viewport of the gallery project "scene" (apps/editor/playwright.gallery.config.ts). */
export const SHOT_SIZE = { width: 1280, height: 800 } as const;

export interface ShotOptions {
  /** The project folder. */
  readonly dir: string;
  /** A scene file. Default: the first scene of the project, or the scene of the sequence. */
  readonly scene?: string;
  readonly sequence?: string;
  /** The named cameras: one picture each. An empty list: the camera of the scene. */
  readonly cameras?: readonly string[];
  /** The time in the sequence (ms). It needs a sequence. */
  readonly at?: number;
  readonly size?: { readonly width: number; readonly height: number };
  readonly backend?: (typeof SHOT_BACKENDS)[number];
  readonly tier?: string;
  /** True (default): the render worker; false: the main-thread core. */
  readonly worker?: boolean;
  /** The picture file; `{camera}` is the camera name. Default `<build>/shots/<name>--<camera>.png`. */
  readonly out?: string;
  /** A baseline PNG; `{camera}` is the camera name and `{platform}` the platform (darwin, linux). */
  readonly compare?: string;
  /** The build folder (default `<project>/dist`). */
  readonly dist?: string;
  /** True: make a new build first. */
  readonly build?: boolean;
  /** The GPU lock file (default the lock of the labs tools). */
  readonly lock?: string;
  /** True: the local browser of the tool, also when the scene pool runs (page/tabs.ts). */
  readonly local?: boolean;
}

/** The picture of one camera. */
export interface ShotPicture {
  readonly camera: string | null;
  readonly file: string | null;
  /** The backend and the path of the player that drew the picture. */
  readonly drawn: { readonly backend: string | null; readonly renderer: string | null };
  readonly error: string | null;
  readonly baseline: string | null;
  readonly comparison: Comparison | null;
}

export interface ShotResult {
  readonly project: string;
  readonly scene: string;
  readonly sequence: string | null;
  readonly pictures: readonly ShotPicture[];
  readonly passed: boolean;
}

/** A path with its `{camera}` and `{platform}` parts filled in. */
export function fillPath(path: string, camera: string | null): string {
  return path.replaceAll("{camera}", camera ?? "scene").replaceAll("{platform}", process.platform);
}

/** The default picture file: `<build>/shots/<scene or sequence name>--<camera>[@<ms>].png`. */
export function defaultShotFile(build: string, target: { scene: string; sequence: string | null }, at?: number) {
  const name = basename(target.sequence ?? target.scene).replace(/\.(scene|sequence)\.json$/, "");
  return join(build, "shots", `${name}--{camera}${at === undefined ? "" : `@${String(at)}`}.png`);
}

interface PictureJob {
  readonly tabs: TabSource;
  readonly spec: PlayerSpec;
  readonly options: ShotOptions;
  readonly file: string;
}

/** The picture of one camera, with its comparison when the options give a baseline. */
async function picture(job: PictureJob, camera: string | null): Promise<ShotPicture> {
  const { options } = job;
  const spec = camera === null ? job.spec : { ...job.spec, page: { ...job.spec.page, camera } };
  const empty = { camera, file: null, baseline: null, comparison: null };
  let tab: PlayerTab | null = null;
  try {
    tab = await job.tabs.open(spec);
    if (options.at !== undefined) await tab.seek(options.at);
    const drawn = await tab.drawn();
    const png = await tab.shot();
    const file = resolve(fillPath(job.file, camera));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    const renderer = spec.page.worker === false ? "main" : "worker";
    if (drawn.backend !== spec.page.backend || drawn.renderer !== renderer) {
      const error = `the player drew with ${drawn.backend ?? "no backend"} (${drawn.renderer ?? "no renderer"}), not ${spec.page.backend} (${renderer})`;
      return { ...empty, file, drawn, error };
    }
    if (options.compare === undefined) return { ...empty, file, drawn, error: null };
    const baseline = resolve(fillPath(options.compare, camera));
    const comparison = comparePng(png, readFileSync(baseline), GALLERY_TOLERANCE);
    return { camera, file, drawn, error: null, baseline, comparison };
  } catch (error) {
    return { ...empty, drawn: { backend: null, renderer: null }, error: errorLine(error) };
  } finally {
    await tab?.close().catch(() => null);
  }
}

/** Run `scenity shot`. `log` gets the progress lines. */
export async function runShot(options: ShotOptions, log: (text: string) => void = () => undefined) {
  const dir = resolve(options.dir);
  let project;
  try {
    project = readBuildProject(dir);
  } catch (error) {
    if (error instanceof BuildSetupError) throw new SetupError(error.message);
    throw error;
  }
  const target = playTarget(dir, project, options);
  if (options.at !== undefined && target.sequence === null)
    throw new SetupError("--at needs a sequence: give --sequence.");
  const cameras = options.cameras?.length ? options.cameras : [null];
  if (cameras.length > 1 && options.out !== undefined && !options.out.includes("{camera}")) {
    throw new SetupError("--out with more than one camera needs {camera} in the path.");
  }
  const dist = options.dist === undefined ? {} : { dist: options.dist };
  const build = await playerBuild(dir, { tool: "scenity shot", build: options.build === true, ...dist }, log);
  const spec: PlayerSpec = {
    out: build.out,
    dir,
    page: {
      ...target,
      backend: options.backend ?? "webgl",
      tier: options.tier ?? "high",
      worker: options.worker ?? true,
    },
    ...(options.size ?? SHOT_SIZE),
  };
  const file = options.out ?? defaultShotFile(build.out, target, options.at);
  const pictures: ShotPicture[] = [];
  const tabs = await tabSource({ tool: "scenity shot", log, ...sourceOptions(options) });
  try {
    for (const camera of cameras) {
      log(`scenity shot: ${project.id} ${target.sequence ?? target.scene} camera ${camera ?? "of the scene"}`);
      pictures.push(await picture({ tabs, spec, options, file }, camera));
    }
  } finally {
    await tabs.close();
  }
  const passed = pictures.every((shot) => shot.error === null && shot.comparison?.passed !== false);
  return { project: project.id, ...target, pictures, passed } satisfies ShotResult;
}
