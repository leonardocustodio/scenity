// SPDX-License-Identifier: Apache-2.0
/**
 * The command lines of the runs: the run
 * of the project for an ID (runCatalog.ts), the check of each argument, the flags that the host adds (`--dry`,
 * `--out`, `--ref`), and the summary and the output folder of a run that ended. Pure functions apart from the file
 * reads of the output folder.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { bunPath } from "./hostRuntime";
import { stripAnsi, type ProjectRun } from "./protocol";
import { activeRunCatalog, programWords, runOf, type RunCatalog } from "./runCatalog";

/** The folder of the Bun workspace in a checkout: the host runs and the built-in project start there. The repo root. */
export const WEB_DIR = ".";

/** The flags whose value is a path. */
const PATH_FLAGS = new Set(["--out", "--review"]);
/** The characters that a shell would read; an argument with one is an error, though no shell runs. */
const SHELL_CHARS = /[;|&$`<>\\]/;
// eslint-disable-next-line no-control-regex -- the check refuses control characters.
const CONTROL = /[\u0000-\u001f\u007f]/;
const IMAGE_EXT = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif"]);

/** True for the ID of a run of the open project (or of the given catalog). */
export function isRunCommand(value: unknown, catalog: RunCatalog = activeRunCatalog()): value is string {
  return runOf(catalog, value) !== null;
}

/** The plan of a run: the program and its arguments, the folder, the output folder and the GPU need. */
export interface RunPlan {
  readonly argv: readonly string[];
  /** The arguments after the command (with the flags of the host), for the page. */
  readonly args: readonly string[];
  readonly cwd: string;
  readonly outDir: string | null;
  readonly gpu: boolean;
  /** The command line of the run without its arguments, for the page. */
  readonly line: string;
}

export interface PlanOptions {
  /** The ID of the run: the name of its output folder. */
  readonly runId: string;
  /** The owner confirmed a run with `confirm` (for example a release) without `--dry`. */
  readonly confirm?: boolean;
  /** The commit at the session start: a run with `ref` gets `--ref <commit>` when it has no `--ref`. */
  readonly ref?: string | null;
  /** The program of Bun (default: the Bun of the host). */
  readonly bun?: string;
  /** The runs of the project (default: the catalog of the open project). */
  readonly catalog?: RunCatalog;
  /** The project folder relative to the checkout ("" or absent: the checkout itself). */
  readonly projectRel?: string;
}

function isPathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith(".") || value.startsWith("~") || value.includes("/");
}

/** Check one argument. A path must be in the checkout (relative paths start at the repo root). */
export function checkArg(arg: unknown, checkout: string, flag: string | null): string {
  if (typeof arg !== "string") throw new Error("Each argument must be a text.");
  if (arg.length > 1000) throw new Error("An argument is longer than 1000 characters.");
  if (CONTROL.test(arg)) throw new Error("An argument has a control character.");
  if (SHELL_CHARS.test(arg))
    throw new Error(`An argument has a character that is not allowed (; | & $ \` < > \\): ${arg}`);
  const value = arg.startsWith("--") && arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
  const pathFlag = flag !== null && PATH_FLAGS.has(flag);
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?\/?$/.test(value) || /^https?:\/\/localhost(:\d+)?\/?$/.test(value)) return arg;
  if (pathFlag || isPathLike(value)) {
    if (value.startsWith("~")) throw new Error(`Give the path without "~": ${value}`);
    const full = isAbsolute(value) ? resolve(value) : resolve(checkout, WEB_DIR, value);
    const near = relative(checkout, full);
    if (near.startsWith("..") || isAbsolute(near)) throw new Error(`The path is not in the checkout: ${value}`);
  }
  return arg;
}

/** The value of a flag (`--flag value` or `--flag=value`), or undefined. */
export function flagValue(args: readonly string[], flag: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === flag) return args[index + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

/** The flags that the host adds to the arguments of a run: `--dry`, `--ref` and `--out`. */
function hostFlags(run: ProjectRun, args: string[], cwd: string, options: PlanOptions): string | null {
  // A run with `confirm` runs as a dry run (--dry) until the owner confirms the real run in the page.
  if (run.confirm && options.confirm !== true && !args.includes("--dry")) args.push("--dry");
  if (run.ref && !hasFlag(args, "--ref") && options.ref) args.push("--ref", options.ref);
  const given = flagValue(args, "--out");
  if (given !== undefined) return isAbsolute(given) ? resolve(given) : resolve(cwd, given);
  // A dry run writes no output. A real run writes into its own output folder (the Runs tab shows it).
  if (run.out === null || (run.confirm && args.includes("--dry"))) return null;
  const outDir = join(cwd, run.out, `${run.id}-${options.runId}`);
  args.push("--out", outDir);
  return outDir;
}

/** True when a run waits for the GPU: its GPU use, a real run for `confirmed`, and no flag of `gpuOff`. */
function usesGpu(run: ProjectRun, args: readonly string[]): boolean {
  const real = !(run.confirm && args.includes("--dry"));
  const gpu = run.gpu === true || (run.gpu === "confirmed" && real);
  return gpu && !run.gpuOff.some((flag) => args.includes(flag));
}

/** Check the arguments of a run of the project and add the flags of the host. */
export function planRun(checkout: string, command: unknown, rawArgs: unknown, options: PlanOptions): RunPlan {
  const run = runOf(options.catalog ?? activeRunCatalog(), command);
  if (run === null) throw new Error(`"${String(command)}" is not a run of the project.`);
  if (!Array.isArray(rawArgs)) throw new Error('The parameter "args" must be a list of texts.');
  const list: readonly unknown[] = rawArgs;
  const args = list.map((arg, index) => {
    const previous = index > 0 ? list[index - 1] : null;
    return checkArg(arg, checkout, typeof previous === "string" && previous.startsWith("--") ? previous : null);
  });
  if (args.length > 40) throw new Error("A run takes at most 40 arguments.");
  const cwd = join(checkout, WEB_DIR, options.projectRel ?? "");
  const outDir = hostFlags(run, args, cwd, options);
  const argv = [...programWords(run.command, options.bun ?? bunPath()), ...args];
  return { argv, args, cwd, outDir, gpu: usesGpu(run, args), line: run.command };
}

/** The line of a `labs` tool that waits for the GPU lock of another process (apps/editor/scripts/lab/gpuLock.ts). */
const GPU_WAIT = /^\S+: waiting for the GPU lock of process \d+/;

/**
 * The summary of a run: its last lines that are not empty, without the ANSI codes and without the command lines that
 * the host and `bun run` print (`$ …`), and without the wait for the GPU lock. Else the verdict line of the `Stop`
 * gate of a background run can be the wait line ("…: waiting for the GPU lock …").
 */
export function summarize(output: string, lines = 12): string {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "" && !line.startsWith("$ ") && !GPU_WAIT.test(line))
    .slice(-lines)
    .join("\n");
}

/**
 * The output folder that a run printed: the folder of the first printed path of an existing file (labs.ts prints the
 * paths of its images, `motion.json` and `REVIEW.md`), or null.
 */
export function printedFolder(output: string, web: string): string | null {
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const word = line.trim().split(/\s+/)[0] ?? "";
    if (!/\.(png|webp|jpe?g|gif|md|json)$/.test(word)) continue;
    const full = isAbsolute(word) ? word : resolve(web, word);
    if (existsSync(full)) return dirname(full);
  }
  return null;
}

/** The images of an output folder (absolute paths), sorted, at most `max`, at most three folders deep. */
export function listImages(folder: string, max = 60): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (found.length >= max) return;
      const full = join(dir, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (depth < 3) walk(full, depth + 1);
      } else if (IMAGE_EXT.has(extname(name).toLowerCase())) found.push(full);
    }
  };
  walk(folder, 0);
  return found;
}
