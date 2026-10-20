// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity verify`: the checks of a project before a commit, with no typecheck (a project has no code of
 * its own to check, or its plugins have their own checks):
 *
 *   scenity verify [project] [--no-shots] [--lock <file>]
 *
 * 1. `scenity check`: the rules of the project;
 * 2. `scenity build --check`: the static build, its size budgets and its marker gate, with a current asset build;
 * 3. `scenity shot --compare` for each baseline of the project: `baselines/<platform>/<scene>--<camera>.png`, where
 *    `<scene>` is the file name of a scene of the project without `.scene.json` and `<camera>` is a named camera, or
 *    `scene` for the camera of the scene. A project with no baselines for the platform has no shot step.
 *
 * The steps run in this order and each step runs, so the output shows all failures. The exit code: 0 when each step
 * passes, 1 when a step fails, 2 for a usage error.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readArgs, type CommandResult } from "../args";
import { readBuildProject } from "../build/run";
import { commandProjectDir, CommandSetupError } from "../workspace";

export const VERIFY_USAGE = "scenity verify [project] [--no-shots] [--lock <file>]";

export const VERIFY_HELP = [
  `usage: ${VERIFY_USAGE}`,
  "The checks of a project: scenity check, scenity build --check, and scenity shot --compare for each baseline",
  "baselines/<platform>/<scene>--<camera>.png of the project (camera `scene`: the camera of the scene). Make a",
  "baseline with: scenity shot --scene scenes/main.scene.json --camera front --out 'baselines/{platform}/main--{camera}.png'",
];

/** One baseline of a project: the scene file, the camera (null: the camera of the scene) and the picture. */
export interface Baseline {
  readonly scene: string;
  readonly camera: string | null;
  readonly file: string;
}

/** The baselines of a project folder for a platform. A picture whose scene is not a scene of the project is not one. */
export function projectBaselines(
  dir: string,
  scenes: readonly string[],
  platform: string = process.platform,
): Baseline[] {
  const folder = join(dir, "baselines", platform);
  if (!existsSync(folder)) return [];
  const byName = new Map(scenes.map((scene) => [basename(scene).replace(/\.scene\.json$/, ""), scene]));
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const match = /^(.+)--([^-][^/]*)\.png$/.exec(name);
      const scene = match?.[1] === undefined ? undefined : byName.get(match[1]);
      if (match?.[2] === undefined || scene === undefined) return [];
      return [{ scene, camera: match[2] === "scene" ? null : match[2], file: join(folder, name) }];
    });
}

/** The options of the arguments after the word `verify`, or null for a usage error. */
export function parseVerifyArgs(argv: readonly string[]): { project?: string; shots: boolean; lock?: string } | null {
  const args = readArgs(argv, ["--project", "--lock"], ["--no-shots"]);
  if (args === null || args.plain.length > 1 || (args.plain.length === 1 && args.values.project !== undefined)) {
    return null;
  }
  const project = args.values.project ?? args.plain[0];
  return {
    ...(project === undefined ? {} : { project }),
    shots: !args.flags.has("--no-shots"),
    ...(args.values.lock === undefined ? {} : { lock: args.values.lock }),
  };
}

/** One step: its name, the command, and the result. */
async function step(out: string[], name: string, run: () => Promise<CommandResult>): Promise<boolean> {
  out.push(`== ${name}`);
  const result = await run();
  out.push(...result.out, `-- ${name}: ${result.code === 0 ? "passed" : "FAILED"}`, "");
  return result.code === 0;
}

/** Run `scenity verify` with the arguments after the word `verify`. */
export async function runVerifyCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseVerifyArgs(argv);
  if (parsed === null) return { out: [`usage: ${VERIFY_USAGE}`], code: 2 };
  let dir: string;
  try {
    dir = commandProjectDir(parsed.project);
  } catch (error) {
    if (error instanceof CommandSetupError) return { out: [error.message], code: 1 };
    throw error;
  }
  const out: string[] = [];
  const results: boolean[] = [];
  const { runCheckCommand } = await import("../check/command");
  results.push(await step(out, "scenity check", () => runCheckCommand([dir])));
  const { runBuildCommand } = await import("../build/command");
  const dist = join(dir, "dist");
  results.push(await step(out, "scenity build --check", () => runBuildCommand([dir, "--check", "--out", dist])));
  const baselines = parsed.shots ? projectBaselines(dir, readBuildProject(dir).scenes) : [];
  const { runShotCommand } = await import("../shot/command");
  for (const baseline of baselines) {
    const name = `scenity shot ${baseline.scene} ${baseline.camera ?? "(scene camera)"}`;
    const shotOut = resolve(dir, "test-results", "verify", basename(baseline.file));
    const args = ["--project", dir, "--scene", baseline.scene, "--dist", dist, "--out", shotOut];
    const camera = baseline.camera === null ? [] : ["--camera", baseline.camera];
    const lock = parsed.lock === undefined ? [] : ["--lock", parsed.lock];
    results.push(
      await step(out, name, () => runShotCommand([...args, ...camera, ...lock, "--compare", baseline.file])),
    );
  }
  if (parsed.shots && baselines.length === 0) out.push(`no baselines in baselines/${process.platform}: no shot step`);
  const failed = results.filter((passed) => !passed).length;
  out.push(
    failed === 0
      ? `scenity verify: passed (${String(results.length)} steps)`
      : `scenity verify: ${String(failed)} of ${String(results.length)} steps FAILED`,
  );
  return { out, code: failed === 0 ? 0 : 1 };
}
