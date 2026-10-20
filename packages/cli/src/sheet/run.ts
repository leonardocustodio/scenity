// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity sheet`: one contact sheet of a scene or a sequence: a cell for each time and camera, drawn by the player of
 * a `scenity build` in headless Chromium (the page code of `scenity shot`, page/). A sheet is the cheapest way to see a
 * motion: one picture to read, not many.
 *
 * The layout is the layout of the lab sheet and of the tool `scene_sheet`
 * (apps/editor/src/core/bridge/sheetCompose.ts): a row per time, a column per camera (one camera: at most four times
 * per row), a cell at most 400 px wide and a sheet at most 1600 px wide, with the label under each cell. The raster is
 * the sheet raster of the platform package (`sheetPicture` of `@scenity/labs-platform/rasterBun`, the sheet of
 * `labs sheet --index`), so the CLI needs no canvas. The pages are tabs of the scene pool when one runs
 * (`scenity pool`; page/tabs.ts), else of a local browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { sheetPicture, type SheetFormat } from "@scenity/labs-platform/rasterBun";
import { BuildSetupError, readBuildProject } from "../build/run";
import { errorLine, type DrawnBy } from "../page/player";
import { sourceOptions, tabSource, type TabSource } from "../page/tabs";
import type { PlayerSpec } from "../pool/target";
import { playerBuild, playTarget, SetupError } from "../page/setup";

/** The most cells of one sheet (MAX_CELLS of the lab sheet): a sheet is one picture to read, not a film. */
export const MAX_CELLS = 64;
const GAP = 4;
/** The viewport of a cell picture before the scale to the cell width. */
export const SHEET_VIEW = { width: 1280, height: 800 } as const;

/** The columns of a sheet: one per camera, else at most four times per row (`sheetColumns` of the lab sheet). */
export function sheetColumns(times: number, cameras: number): number {
  return cameras > 1 ? cameras : Math.max(1, Math.min(times, 4));
}

/** The width of a cell: at most `cell`, and the sheet at most `maxWidth` wide (`cellWidth` of the lab sheet). */
export function cellWidth(columns: number, cell = 400, maxWidth = 1600): number {
  return Math.max(16, Math.min(cell, Math.floor((maxWidth - GAP) / columns) - GAP));
}

/** The label of a cell: the time (with a sequence) and the camera (`labelOf` of `scene_sheet`). */
export function cellLabel(time: number | null, camera: string | null): string {
  const view = camera ?? "scene camera";
  return time === null ? view : `${String(time)} ms · ${view}`;
}

export interface SheetOptions {
  readonly dir: string;
  readonly scene?: string;
  readonly sequence?: string;
  /** The times of the rows (ms). They need a sequence. Empty: one row at 0 ms (no sequence: the scene). */
  readonly times: readonly number[];
  /** The named cameras of the columns. Empty: the camera of the scene. */
  readonly cameras: readonly string[];
  readonly cell?: number;
  readonly maxWidth?: number;
  readonly format?: SheetFormat;
  readonly size?: { readonly width: number; readonly height: number };
  readonly backend?: string;
  readonly tier?: string;
  readonly worker?: boolean;
  /** The sheet file. Default `<build>/sheets/<name>.<format>`. */
  readonly out?: string;
  readonly dist?: string;
  readonly build?: boolean;
  readonly lock?: string;
  /** True: the local browser of the tool, also when the scene pool runs (page/tabs.ts). */
  readonly local?: boolean;
}

export interface SheetResult {
  readonly project: string;
  readonly scene: string;
  readonly sequence: string | null;
  readonly file: string | null;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly cells: readonly { readonly time: number | null; readonly camera: string | null }[];
  readonly drawn: readonly DrawnBy[];
  readonly error: string | null;
  readonly passed: boolean;
}

interface Cell {
  readonly bytes: Uint8Array;
  readonly label: string;
}

/** The pictures of one camera at each time, from one player tab. */
async function cameraCells(
  tabs: TabSource,
  spec: PlayerSpec,
  camera: string | null,
  times: readonly (number | null)[],
): Promise<{ cells: Cell[]; drawn: DrawnBy }> {
  const tab = await tabs.open(camera === null ? spec : { ...spec, page: { ...spec.page, camera } });
  try {
    const cells: Cell[] = [];
    for (const time of times) {
      if (time !== null) await tab.seek(time);
      cells.push({ bytes: new Uint8Array(await tab.shot()), label: cellLabel(time, camera) });
    }
    return { cells, drawn: await tab.drawn() };
  } finally {
    await tab.close();
  }
}

/** The project and the play target of the options, with the setup checks of a sheet. */
function sheetTarget(options: SheetOptions) {
  const dir = resolve(options.dir);
  let project;
  try {
    project = readBuildProject(dir);
  } catch (error) {
    if (error instanceof BuildSetupError) throw new SetupError(error.message);
    throw error;
  }
  const target = playTarget(dir, project, options);
  if (options.times.length > 0 && target.sequence === null) {
    throw new SetupError("The scene has no sequence, so the sheet takes no times: give --sequence, or cameras only.");
  }
  const cells = Math.max(1, options.times.length) * Math.max(1, options.cameras.length);
  if (cells > MAX_CELLS) throw new SetupError(`A sheet has at most ${String(MAX_CELLS)} cells (times × cameras).`);
  return { dir, project, target };
}

/** Run `scenity sheet`. `log` gets the progress lines. */
export async function runSheet(options: SheetOptions, log: (text: string) => void = () => undefined) {
  const { dir, project, target } = sheetTarget(options);
  const times: (number | null)[] = target.sequence === null ? [null] : options.times.length ? [...options.times] : [0];
  const cameras: (string | null)[] = options.cameras.length ? [...options.cameras] : [null];
  const dist = options.dist === undefined ? {} : { dist: options.dist };
  const build = await playerBuild(dir, { tool: "scenity sheet", build: options.build === true, ...dist }, log);
  const size = options.size ?? SHEET_VIEW;
  const page = {
    ...target,
    backend: options.backend ?? "webgl",
    tier: options.tier ?? "high",
    worker: options.worker ?? true,
  };
  const spec: PlayerSpec = { out: build.out, dir, page, ...size };
  const columns = sheetColumns(times.length, cameras.length);
  const width = cellWidth(columns, options.cell, options.maxWidth);
  const format = options.format ?? "png";
  const name = basename(target.sequence ?? target.scene).replace(/\.(scene|sequence)\.json$/, "");
  const file = resolve(options.out ?? join(build.out, "sheets", `${name}.${format === "jpeg" ? "jpg" : "png"}`));
  const order = times.flatMap((time) => cameras.map((camera) => ({ time, camera })));
  const base = { project: project.id, ...target, columns, cells: order };
  const byCamera = new Map<string | null, Cell[]>();
  const drawn: DrawnBy[] = [];
  const tabs = await tabSource({ tool: "scenity sheet", log, ...sourceOptions(options) });
  try {
    for (const camera of cameras) {
      log(`scenity sheet: ${project.id} ${target.sequence ?? target.scene} camera ${camera ?? "of the scene"}`);
      const made = await cameraCells(tabs, spec, camera, times);
      byCamera.set(camera, made.cells);
      drawn.push(made.drawn);
    }
  } catch (error) {
    return { ...base, file: null, width: 0, height: 0, drawn, error: errorLine(error), passed: false };
  } finally {
    await tabs.close();
  }
  const cells = order.map(({ time, camera }) => {
    const cell = byCamera.get(camera)?.[times.indexOf(time)];
    if (cell === undefined) throw new Error("scenity sheet: a cell is missing.");
    return { ...cell, aspect: size.width / size.height };
  });
  const picture = await sheetPicture(cells, columns, width, format);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, picture.bytes);
  const renderer = page.worker ? "worker" : "main";
  const wrong = drawn.find((by) => by.backend !== page.backend || by.renderer !== renderer);
  const error =
    wrong === undefined
      ? null
      : `the player drew with ${wrong.backend ?? "no backend"} (${wrong.renderer ?? "no renderer"}), not ${page.backend} (${renderer})`;
  const { width: sheetWidth, height } = picture;
  return { ...base, file, width: sheetWidth, height, drawn, error, passed: error === null } satisfies SheetResult;
}
