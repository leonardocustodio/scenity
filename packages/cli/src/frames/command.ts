// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity frames`:
 *
 *   scenity frames [project] [--step <ms>] [--size 480x300] [--backend webgl|webgpu] [--dist <dir>] [--build]
 *     [--lock <file>] [--local] [--json]
 *
 * It draws the frame index of the project (run.ts): each frame that has no picture yet. The exit code: 0, 1 for a
 * failure, 2 for a usage error.
 */
import { numberOf, readArgs, sizeOf, type CommandResult } from "../args";
import { SetupError } from "../page/setup";
import { runFrames, type FramesOptions, type FramesResult } from "./run";

export const FRAMES_USAGE =
  "scenity frames [project] [--step <ms>] [--size 480x300] [--backend webgl|webgpu] [--dist <dir>] [--build] " +
  "[--lock <file>] [--local] [--json]";

export const FRAMES_HELP = [
  `usage: ${FRAMES_USAGE}`,
  "The frame index of the project: a picture of each plan (each sequence, each scene with no sequence), each",
  "document camera and each time (0 ms and the markers and key times of a sequence; --step adds a time each step ms).",
  "It draws only the frames with no picture into .scenity/frames/ and keeps two pictures of each place.",
];

const VALUES = ["--project", "--step", "--size", "--backend", "--dist", "--lock"];

/** The options of the arguments after the word `frames`, or null for a usage error. */
export function parseFramesArgs(argv: readonly string[]): { options: FramesOptions; json: boolean } | null {
  const args = readArgs(argv, VALUES, ["--build", "--local", "--json"]);
  if (args === null || args.plain.length > 1 || (args.plain.length === 1 && args.values.project !== undefined)) {
    return null;
  }
  const { values } = args;
  const step = numberOf(values.step, 0);
  const size = values.size === undefined ? undefined : sizeOf(values.size);
  if (step === null || size === null) return null;
  if (values.backend !== undefined && values.backend !== "webgl" && values.backend !== "webgpu") return null;
  const keep = (key: string) => (values[key] === undefined ? {} : { [key]: values[key] });
  const options: FramesOptions = {
    dir: values.project ?? args.plain[0] ?? ".",
    step,
    ...(size === undefined ? {} : { size }),
    ...keep("backend"),
    ...keep("dist"),
    ...keep("lock"),
    build: args.flags.has("--build"),
    ...(args.flags.has("--local") ? { local: true } : {}),
  };
  return { options, json: args.flags.has("--json") };
}

/** The lines of a result. */
export function framesText(result: FramesResult): string[] {
  const head = `scenity frames: ${result.project}: ${String(result.frames)} frames, ${String(result.drawn)} drawn, ${String(result.listed)} listed`;
  return result.error === null ? [head] : [head, `failed: ${result.error}`];
}

/** Run `scenity frames` with the arguments after the word `frames`. */
export async function runFramesCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseFramesArgs(argv);
  if (parsed === null) return { out: [`usage: ${FRAMES_USAGE}`], code: 2 };
  try {
    const result = await runFrames(parsed.options, (text) => console.error(text));
    return { out: parsed.json ? [JSON.stringify(result, null, 2)] : framesText(result), code: result.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    return { out: [error.message], code: 1 };
  }
}
