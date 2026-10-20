// SPDX-License-Identifier: Apache-2.0
/**
 * The asset step of `scenity build`: the asset build of `@scenity/assets` with its manifest of version 2. A project
 * with `build.assets` keeps its build in its output folder: the step writes it there, or with `--check` it checks that
 * the written files are current. A project with no `build.assets` gets the build with the default settings in memory
 * only. In both cases, the build folder gets the same bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildProject, compareWithWritten, ModelCache, writeOutput } from "@scenity/assets/build";
import type { ProjectDocument } from "@scenity/scene";

/** The cache folder of the optimized models, relative to the project folder (the same as the asset CLI). */
const BUILD_CACHE = ".scenity/cache/build";

/** How the step got the asset files. */
export type AssetMode = "written" | "checked" | "memory";

export interface AssetStep {
  readonly mode: AssetMode;
  /** The file names of the asset build, with `manifest.json`. */
  readonly files: readonly string[];
  readonly bytes: number;
  readonly problems: readonly string[];
}

/** Run the asset build of a project and write its files into `target` (a folder of the build). */
export async function assetStep(
  dir: string,
  project: ProjectDocument,
  target: string,
  check: boolean,
): Promise<AssetStep> {
  const declared = project.build?.assets !== undefined;
  const cache = new ModelCache(true, join(dir, BUILD_CACHE));
  const output = await buildProject(dir, { cache });
  cache.prune();
  const problems = output.findings
    .filter((finding) => finding.level === "error")
    .map((finding) => `asset ${finding.asset}: ${finding.message}`);
  let mode: AssetMode = "memory";
  if (declared && problems.length === 0) {
    const where = relative(process.cwd(), output.outputDir) || ".";
    if (check) {
      mode = "checked";
      const differences = compareWithWritten(output, output.outputDir);
      if (differences.length > 0) {
        problems.push(
          `the asset build in ${where} is not current (${differences.slice(0, 3).join("; ")}). ` +
            `Run: bun packages/assets/src/cli.ts build ${relative(process.cwd(), dir) || "."}`,
        );
      }
    } else {
      mode = "written";
      writeOutput(output, output.outputDir);
    }
  }
  mkdirSync(target, { recursive: true });
  let bytes = 0;
  for (const [name, data] of output.files) {
    writeFileSync(join(target, name), data);
    bytes += data.byteLength;
  }
  return { mode, files: [...output.files.keys()], bytes, problems };
}
