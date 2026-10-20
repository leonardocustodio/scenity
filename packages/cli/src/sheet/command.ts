// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity sheet`:
 *
 *   scenity sheet [project] [--scene <path>] [--sequence <path>] [--camera <a,b>] [--times <a,b>]
 *     [--from <ms> --to <ms> [--step <ms>]] [--cell <px>] [--max-width <px>] [--format png|jpeg] [--size 1280x800]
 *     [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file>] [--dist <dir>] [--build] [--lock <file>]
 *     [--local] [--json]
 *
 * The times come from `--times`, or from `--from` to `--to` in steps of `--step` (default: 8 times). The command draws
 * in warm pages of the scene pool when one runs (`scenity pool`); `--local` opens a local browser. The exit code: 0,
 * 1 for a failure, 2 for a usage error.
 */
import { numberOf, readArgs, sizeOf, type CommandResult } from "../args";
import { SetupError } from "../page/setup";
import { MAX_CELLS, runSheet, type SheetOptions, type SheetResult } from "./run";

export const SHEET_USAGE =
  "scenity sheet [project] [--scene <path>] [--sequence <path>] [--camera <a,b>] [--times <a,b>] " +
  "[--from <ms> --to <ms> [--step <ms>]] [--cell <px>] [--max-width <px>] [--format png|jpeg] [--size 1280x800] " +
  "[--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file>] [--dist <dir>] [--build] [--lock <file>] " +
  "[--local] [--json]";

export const SHEET_HELP = [
  `usage: ${SHEET_USAGE}`,
  "One contact sheet: a row per time, a column per camera, drawn by the player of the project build in headless",
  "Chromium under the GPU lock (the layout of the lab sheet and of scene_sheet). Times need a sequence. Default:",
  "the scene camera at 0 ms; the sheet goes to <build>/sheets/<name>.png.",
];

const VALUES = [
  "--project",
  "--scene",
  "--sequence",
  "--camera",
  "--times",
  "--from",
  "--to",
  "--step",
  "--cell",
  "--max-width",
  "--format",
  "--size",
  "--backend",
  "--tier",
  "--worker",
  "--out",
  "--dist",
  "--lock",
];

/** The times of `--times`, or of `--from`, `--to` and `--step`; null for a usage error. */
export function sheetTimes(values: Readonly<Record<string, string>>): number[] | null {
  if (values.times !== undefined) {
    const times = values.times.split(",").map((text) => Number(text));
    return times.every((time) => Number.isInteger(time) && time >= 0) ? times : null;
  }
  if (values.from === undefined && values.to === undefined) return values.step === undefined ? [] : null;
  const from = numberOf(values.from, 0);
  const to = numberOf(values.to, -1);
  if (from === null || to === null || to < from) return null;
  const step = numberOf(values.step, Math.max(1, (to - from) / 7), 1);
  if (step === null) return null;
  const times: number[] = [];
  for (let time = from; time <= to + 1e-6 && times.length <= MAX_CELLS; time += step) times.push(Math.round(time));
  return times;
}

/** The options of the arguments after the word `sheet`, or null for a usage error. */
export function parseSheetArgs(argv: readonly string[]): { options: SheetOptions; json: boolean } | null {
  const args = readArgs(argv, VALUES, ["--build", "--local", "--json"]);
  if (args === null || args.plain.length > 1 || (args.plain.length === 1 && args.values.project !== undefined)) {
    return null;
  }
  const { values } = args;
  const times = sheetTimes(values);
  const size = values.size === undefined ? undefined : sizeOf(values.size);
  const cell = numberOf(values.cell, 400, 16);
  const maxWidth = numberOf(values["max-width"], 1600, 64);
  const format = values.format ?? "png";
  if (times === null || size === null || cell === null || maxWidth === null) return null;
  if ((format !== "png" && format !== "jpeg") || !["0", "1", undefined].includes(values.worker)) return null;
  if (values.backend !== undefined && values.backend !== "webgl" && values.backend !== "webgpu") return null;
  const keep = (key: string) => (values[key] === undefined ? {} : { [key]: values[key] });
  const options: SheetOptions = {
    dir: values.project ?? args.plain[0] ?? ".",
    ...keep("scene"),
    ...keep("sequence"),
    ...keep("backend"),
    ...keep("tier"),
    ...keep("out"),
    ...keep("dist"),
    ...keep("lock"),
    times,
    cameras: (values.camera ?? "").split(",").filter((name) => name !== ""),
    cell,
    maxWidth,
    format,
    ...(size === undefined ? {} : { size }),
    ...(values.worker === undefined ? {} : { worker: values.worker === "1" }),
    build: args.flags.has("--build"),
    ...(args.flags.has("--local") ? { local: true } : {}),
  };
  return { options, json: args.flags.has("--json") };
}

/** The lines of a sheet result. */
export function sheetText(result: SheetResult): string[] {
  if (result.file === null) return [`scenity sheet: failed: ${result.error ?? "no sheet"}`];
  const size = `${String(result.width)}×${String(result.height)}`;
  const head = `scenity sheet: ${result.file} (${size}, ${String(result.cells.length)} cells)`;
  return result.error === null ? [head] : [head, `failed: ${result.error}`];
}

/** Run `scenity sheet` with the arguments after the word `sheet`. */
export async function runSheetCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseSheetArgs(argv);
  if (parsed === null) return { out: [`usage: ${SHEET_USAGE}`], code: 2 };
  try {
    const result = await runSheet(parsed.options, (text) => console.error(text));
    return { out: parsed.json ? [JSON.stringify(result, null, 2)] : sheetText(result), code: result.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    return { out: [error.message], code: 1 };
  }
}
