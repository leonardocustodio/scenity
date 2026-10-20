// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity shot`. Run it from the repo root:
 *
 *   bun packages/cli/src/cli.ts shot [--project <dir>] [--scene <path>] [--sequence <path>] [--camera <a,b>]
 *     [--at <ms>] [--size 1280x800] [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.png>]
 *     [--compare <baseline.png>] [--dist <dir>] [--build] [--lock <file>] [--local] [--json]
 *
 * The command draws in a warm page of the scene pool when one runs (`scenity pool`). `--local` draws in a local
 * browser.
 *
 * The project folder defaults to the work folder. A path of `--out` and `--compare` can hold `{camera}` (the camera
 * name) and `{platform}` (darwin, linux), as the baseline paths of the gallery. The exit codes:
 *
 * - 0: each picture is written (with `--compare`: and each picture is in the tolerance of the gallery);
 * - 1: the setup or a picture failed, the player drew with another backend or path, or a picture is out of the
 *   tolerance;
 * - 2: a usage error.
 */
import type { Comparison } from "./compare";
import { runShot, SHOT_BACKENDS, SHOT_TIERS, type ShotOptions, type ShotPicture } from "./run";
import { SetupError } from "../page/setup";

export const SHOT_USAGE =
  "bun packages/cli/src/cli.ts shot [--project <dir>] [--scene <path>] [--sequence <path>] [--camera <a,b>] " +
  "[--at <ms>] [--size 1280x800] [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.png>] " +
  "[--compare <baseline.png>] [--dist <dir>] [--build] [--lock <file>] [--local] [--json]";

const VALUE_FLAGS = new Set([
  "--project",
  "--scene",
  "--sequence",
  "--camera",
  "--at",
  "--size",
  "--backend",
  "--tier",
  "--worker",
  "--out",
  "--compare",
  "--dist",
  "--lock",
]);
const PATH_KEYS = ["scene", "sequence", "out", "compare", "dist", "lock"] as const;

/** The values of the arguments: the flags with a value, the plain flags and the plain words. */
function readArgs(argv: readonly string[]) {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const plain: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json" || arg === "--build" || arg === "--local") flags.add(arg);
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--")) return null;
    else plain.push(arg);
  }
  return { values, flags, plain };
}

/** The width and height of `--size` (for example 1280x800), or null. */
function sizeOf(text: string | undefined) {
  if (text === undefined) return undefined;
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(text);
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/** The options of the arguments after the word `shot`, or null for a usage error. */
export function parseShotArgs(argv: readonly string[]): { options: ShotOptions; json: boolean } | null {
  const args = readArgs(argv);
  if (args === null) return null;
  const { values, flags, plain } = args;
  const { backend, tier, worker } = values;
  const at = values.at === undefined ? undefined : Number(values.at);
  const size = sizeOf(values.size);
  if (plain.length > 1 || (plain.length === 1 && values.project !== undefined)) return null;
  if (at !== undefined && (!Number.isFinite(at) || at < 0)) return null;
  if (size === null || (worker !== undefined && worker !== "0" && worker !== "1")) return null;
  if (backend !== undefined && !(SHOT_BACKENDS as readonly string[]).includes(backend)) return null;
  if (tier !== undefined && !(SHOT_TIERS as readonly string[]).includes(tier)) return null;
  const cameras = (values.camera ?? "").split(",").filter((name) => name !== "");
  const paths = Object.fromEntries(PATH_KEYS.flatMap((key) => (values[key] === undefined ? [] : [[key, values[key]]])));
  const options: ShotOptions = {
    dir: values.project ?? plain[0] ?? ".",
    ...paths,
    cameras,
    ...(at === undefined ? {} : { at }),
    ...(size === undefined ? {} : { size }),
    ...(backend === undefined ? {} : { backend: backend as ShotOptions["backend"] & string }),
    ...(tier === undefined ? {} : { tier }),
    ...(worker === undefined ? {} : { worker: worker === "1" }),
    build: flags.has("--build"),
    ...(flags.has("--local") ? { local: true } : {}),
  };
  return { options, json: flags.has("--json") };
}

function comparisonText(comparison: Comparison, baseline: string): string {
  const { size, baselineSize } = comparison;
  if (size.width !== baselineSize.width || size.height !== baselineSize.height) {
    const sizes = `${String(size.width)}x${String(size.height)}, the baseline ${String(baselineSize.width)}x${String(baselineSize.height)}`;
    return `differs from ${baseline}: the size is ${sizes}`;
  }
  const verdict = comparison.passed ? "in the tolerance of" : "out of the tolerance of";
  const share = ((comparison.differ / (size.width * size.height)) * 100).toFixed(3);
  return `${verdict} ${baseline}: ${String(comparison.differ)} pixels differ (${share} %), limit ${String(Math.floor(comparison.limit))}`;
}

/** The line of one picture. */
export function pictureLine(shot: ShotPicture): string {
  const name = shot.camera ?? "the scene camera";
  if (shot.file === null) return `${name}: failed: ${shot.error ?? "no picture"}`;
  const drawn = `${shot.drawn.backend ?? "?"}, ${shot.drawn.renderer ?? "?"}`;
  const head = `${name}: ${shot.file} (${drawn})`;
  if (shot.error !== null) return `${head}: failed: ${shot.error}`;
  if (shot.comparison === null || shot.baseline === null) return head;
  return `${head}: ${comparisonText(shot.comparison, shot.baseline)}`;
}

/** Run `scenity shot` with the arguments after the word `shot`. Progress lines go to `log`. */
export async function runShotCommand(
  argv: readonly string[],
  log: (text: string) => void = (text) => console.error(text),
): Promise<{ out: string[]; code: number }> {
  const parsed = parseShotArgs(argv);
  if (parsed === null) return { out: [`usage: ${SHOT_USAGE}`], code: 2 };
  try {
    const result = await runShot(parsed.options, log);
    const out = parsed.json ? [JSON.stringify(result, null, 2)] : result.pictures.map(pictureLine);
    return { out, code: result.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    const out = parsed.json ? [JSON.stringify({ error: error.message, passed: false }, null, 2)] : [error.message];
    return { out, code: 1 };
  }
}
