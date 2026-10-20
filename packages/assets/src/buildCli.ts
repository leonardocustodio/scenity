// SPDX-License-Identifier: Apache-2.0
/**
 * The `build` command of the asset CLI. Run from the repo root:
 *
 *   bun packages/assets/src/cli.ts build <projectDir> [--check] [--json] [--no-cache] [--no-import]
 *
 * The command builds each asset of the project (build/project.ts) and writes the files into the output folder of the
 * project (`build.assets.output`, default `build`). `--check` builds in memory and compares the bytes with the written
 * files. `--no-import` does not run the importers: a model reads a current import, else its source. The cache of the
 * optimized models is `<projectDir>/.scenity/cache/build`. `--no-cache` optimizes each model again. The exit code is 1
 * for an error finding or a stale file, and 2 for a usage error.
 */
import { join, relative, resolve } from "node:path";
import { writeBuildState } from "./build/buildState";
import { ModelCache } from "./build/cache";
import { compareWithWritten, writeOutput } from "./build/output";
import { buildProject } from "./build/project";
import { AssetDatabase, ProjectReadError } from "./database";
import { toPosix } from "./files";
import type { ImporterRegistry } from "./import/registry";

export const BUILD_USAGE =
  "bun packages/assets/src/cli.ts build <projectDir> [--check] [--json] [--no-cache] [--no-import]";

const FLAGS = new Set(["--check", "--json", "--no-cache", "--no-import"]);

/** The cache folder of the optimized models of a project, relative to the project folder. */
export const BUILD_CACHE = ".scenity/cache/build";

/** Run the build command with its arguments (after the word `build`). */
export async function runBuildCli(
  argv: readonly string[],
  registry?: ImporterRegistry,
): Promise<{ out: string[]; code: number }> {
  const plain = argv.filter((arg) => !FLAGS.has(arg));
  const [dir] = plain;
  if (dir === undefined || plain.length > 1 || plain.some((arg) => arg.startsWith("--"))) {
    return { out: [`usage: ${BUILD_USAGE}`], code: 2 };
  }
  const flags = new Set(argv);
  const started = performance.now();
  const cache = new ModelCache(!flags.has("--no-cache"), join(resolve(dir), BUILD_CACHE));
  let output;
  try {
    output = await buildProject(dir, {
      cache,
      runImports: !flags.has("--no-import"),
      ...(registry === undefined ? {} : { registry }),
    });
  } catch (error) {
    if (error instanceof ProjectReadError) return { out: [error.message], code: 2 };
    throw error;
  }
  cache.prune();
  const errors = output.findings.filter((finding) => finding.level === "error");
  const where = toPosix(relative(process.cwd(), output.outputDir));
  const differences = errors.length === 0 && flags.has("--check") ? compareWithWritten(output, output.outputDir) : [];
  if (errors.length === 0 && !flags.has("--check")) writeOutput(output, output.outputDir);
  // The build state of each asset, for the asset build panel of the editor.
  if (!flags.has("--check")) writeBuildState(await AssetDatabase.open(dir), output.findings);
  const code = errors.length > 0 || differences.length > 0 ? 1 : 0;
  if (flags.has("--json")) {
    const outputs = Object.fromEntries(output.outputs);
    return {
      out: [JSON.stringify({ project: output.project, findings: output.findings, outputs, differences }, null, 2)],
      code,
    };
  }
  const out = output.findings.map(
    (finding) => `${finding.level === "error" ? "ERROR" : "warning"} ${finding.asset}: ${finding.message}`,
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const name = `${output.project} build`;
  if (cache.hits + cache.misses > 0) {
    out.push(`${name}: ${String(cache.hits)} optimized models from the cache, ${String(cache.misses)} new`);
  }
  if (errors.length > 0) out.push(`${name}: ${String(errors.length)} errors (${seconds} s)`);
  else if (differences.length > 0) {
    out.push(`${name}: the files in ${where} are not current. Run: bun packages/assets/src/cli.ts build ${dir}`);
    out.push(...differences.map((line) => `  ${line}`));
  } else if (flags.has("--check"))
    out.push(`${name}: ${String(output.files.size)} files current in ${where} (${seconds} s)`);
  else {
    const bytes = [...output.files.values()].reduce((sum, file) => sum + file.byteLength, 0);
    out.push(
      `${name}: wrote ${String(output.files.size)} files, ${String(Math.round(bytes / 1024))} KB to ${where} (${seconds} s)`,
    );
  }
  return { out, code };
}
