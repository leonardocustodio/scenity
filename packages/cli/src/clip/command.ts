// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity clip`:
 *
 *   scenity clip [project] --from <ms> --to <ms> [--sequence <path>] [--scene <path>] [--camera <name>] [--fps <n>]
 *     [--size 640x400] [--key-every <n>] [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.webm>]
 *     [--dist <dir>] [--build] [--lock <file>] [--local] [--json]
 *
 * The command draws in warm pages of the scene pool when one runs (`scenity pool`); `--local` opens its own
 * browser. The exit code: 0, 1 for a failure, 2 for a usage error.
 */
import { numberOf, readArgs, sizeOf, type CommandResult } from "../args";
import { SetupError } from "../page/setup";
import { MAX_FRAMES, runClip, type ClipOptions, type ClipResult } from "./run";

export const CLIP_USAGE =
  "scenity clip [project] --from <ms> --to <ms> [--sequence <path>] [--scene <path>] [--camera <name>] [--fps <n>] " +
  "[--size 640x400] [--key-every <n>] [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.webm>] " +
  "[--dist <dir>] [--build] [--lock <file>] [--local] [--json]";

export const CLIP_HELP = [
  `usage: ${CLIP_USAGE}`,
  "A WebM video (VP9, else VP8) of a time range of a sequence from one camera, drawn by the player of the project",
  "build in headless Chromium under the GPU lock: a seek and a screenshot per frame, so the clip does not depend on",
  `the speed of the machine. Default: 12 fps, 640x400, at most ${String(MAX_FRAMES)} frames; the video goes to`,
  "<build>/clips/.",
];

const VALUES = [
  "--project",
  "--scene",
  "--sequence",
  "--camera",
  "--from",
  "--to",
  "--fps",
  "--size",
  "--key-every",
  "--backend",
  "--tier",
  "--worker",
  "--out",
  "--dist",
  "--lock",
];

/** The options of the arguments after the word `clip`, or null for a usage error. */
export function parseClipArgs(argv: readonly string[]): { options: ClipOptions; json: boolean } | null {
  const args = readArgs(argv, VALUES, ["--build", "--local", "--json"]);
  if (args === null || args.plain.length > 1 || (args.plain.length === 1 && args.values.project !== undefined)) {
    return null;
  }
  const { values } = args;
  const from = numberOf(values.from, -1);
  const to = numberOf(values.to, -1);
  const fps = numberOf(values.fps, 12, 1);
  const keyEvery = numberOf(values["key-every"], 0, 1);
  const size = values.size === undefined ? undefined : sizeOf(values.size);
  if (from === null || to === null || from < 0 || to < from || fps === null || fps > 60 || keyEvery === null) {
    return null;
  }
  if (size === null || !["0", "1", undefined].includes(values.worker)) return null;
  if (values.backend !== undefined && values.backend !== "webgl" && values.backend !== "webgpu") return null;
  const keep = (key: string) => (values[key] === undefined ? {} : { [key]: values[key] });
  const options: ClipOptions = {
    dir: values.project ?? args.plain[0] ?? ".",
    ...keep("scene"),
    ...keep("sequence"),
    ...keep("camera"),
    ...keep("backend"),
    ...keep("tier"),
    ...keep("out"),
    ...keep("dist"),
    ...keep("lock"),
    from: Math.round(from),
    to: Math.round(to),
    fps,
    ...(keyEvery === 0 ? {} : { keyEvery: Math.round(keyEvery) }),
    ...(size === undefined ? {} : { size }),
    ...(values.worker === undefined ? {} : { worker: values.worker === "1" }),
    build: args.flags.has("--build"),
    ...(args.flags.has("--local") ? { local: true } : {}),
  };
  return { options, json: args.flags.has("--json") };
}

/** The lines of a clip result. */
export function clipText(result: ClipResult): string[] {
  if (result.file === null) return [`scenity clip: failed: ${result.error ?? "no clip"}`];
  const kb = (result.bytes / 1024).toFixed(1);
  const size = `${String(result.width)}×${String(result.height)}`;
  return [
    `scenity clip: ${result.file} (${result.codec ?? "?"}, ${size}, ${String(result.times.length)} frames, ${kb} KB)`,
  ];
}

/** Run `scenity clip` with the arguments after the word `clip`. */
export async function runClipCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseClipArgs(argv);
  if (parsed === null) return { out: [`usage: ${CLIP_USAGE}`], code: 2 };
  try {
    const result = await runClip(parsed.options, (text) => console.error(text));
    return { out: parsed.json ? [JSON.stringify(result, null, 2)] : clipText(result), code: result.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    return { out: [error.message], code: 1 };
  }
}
