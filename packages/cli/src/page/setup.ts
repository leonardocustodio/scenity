// SPDX-License-Identifier: Apache-2.0
/**
 * The setup of a player page run of `scenity bench` and `scenity shot`: the scene and the sequence of the run, and the
 * `scenity build` folder that the page server serves.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { builtinRegistry, readDocument, type ProjectDocument } from "@scenity/scene";
import { runBuild } from "../build/run";

/** A setup problem: no project, a scene that does not exist, no build. */
export class SetupError extends Error {}

/** The path of a file in the project folder (relative, with "/"), from a path of the project or of the work folder. */
export function projectFile(dir: string, path: string): string {
  if (existsSync(join(dir, ...path.split("/")))) return path.split(sep).join("/");
  const near = relative(dir, resolve(path));
  if (near.startsWith("..") || isAbsolute(near) || !existsSync(resolve(path))) {
    throw new SetupError(`${path} is not a file of the project folder ${dir}.`);
  }
  return near.split(sep).join("/");
}

/** The scene and the sequence of a run. A sequence with no `scene` plays on the project scene with its ID. */
export function playTarget(
  dir: string,
  project: ProjectDocument,
  options: { readonly scene?: string; readonly sequence?: string },
): { scene: string; sequence: string | null } {
  const sequence = options.sequence === undefined ? null : projectFile(dir, options.sequence);
  if (options.scene !== undefined) return { scene: projectFile(dir, options.scene), sequence };
  if (sequence === null) {
    const first = project.scenes[0];
    if (first === undefined) throw new SetupError("The project has no scene: give --scene.");
    return { scene: first, sequence };
  }
  const registry = builtinRegistry();
  const read = readDocument(readFileSync(join(dir, ...sequence.split("/")), "utf8"), "sequence", { registry });
  if (!read.ok) throw new SetupError(`${sequence} does not read: ${read.errors[0]?.message ?? "no reason"}`);
  for (const path of project.scenes) {
    const file = join(dir, ...path.split("/"));
    const scene = existsSync(file) ? readDocument(readFileSync(file, "utf8"), "scene", { registry }) : null;
    if (scene?.ok === true && scene.doc.id === read.doc.scene) return { scene: path, sequence };
  }
  throw new SetupError(`No scene of the project has the ID "${read.doc.scene}" of ${sequence}: give --scene.`);
}

/**
 * The build folder of a run: the current folder (default `<project>/dist`), or a new build with `scenity build
 * --check` when `build` is true or the folder has no player. `tool` is the command name of the log lines.
 */
export async function playerBuild(
  dir: string,
  options: { readonly dist?: string; readonly build?: boolean; readonly tool: string },
  log: (text: string) => void,
): Promise<{ out: string; made: boolean }> {
  const out = resolve(options.dist ?? join(dir, "dist"));
  const ready =
    existsSync(join(out, "player", "element.js")) && existsSync(join(out, "project", "scenity.project.json"));
  if (ready && options.build !== true) return { out, made: false };
  log(`${options.tool}: building ${relative(process.cwd(), dir) || "."} into ${out}`);
  const built = await runBuild({ dir, out, check: true });
  for (const problem of built.report.problems) log(`${options.tool}: build problem: ${problem}`);
  if (!existsSync(join(out, "player", "element.js"))) throw new SetupError(`The build in ${out} has no player.`);
  return { out, made: true };
}
