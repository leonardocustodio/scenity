// SPDX-License-Identifier: Apache-2.0
/**
 * The `export` command of the asset CLI: the glTF export of a scene. Run from the repo root:
 *
 *   bun packages/assets/src/cli.ts export <projectDir> <scene> [--out <file.glb>] [--no-import] [--json]
 *
 * `<scene>` is the ID of a scene of the project, or the path of a scene file relative to the project folder. The
 * default output is `<projectDir>/.scenity/exports/<scene id>.glb`. `--no-import` does not run the importers: a model
 * reads a current import, else its source. The exit code is 2 for a usage error, a project that does not read or a
 * scene that is not found; a warning does not change the exit code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { CliResult } from "./cli";
import { ProjectReadError } from "./database";
import { ExportError, exportScene, type SceneExport } from "./export/project";
import { toPosix } from "./files";

export const EXPORT_USAGE =
  "bun packages/assets/src/cli.ts export <projectDir> <scene> [--out <file.glb>] [--no-import] [--json]";

/** The folder of the default output, relative to the project folder. */
export const EXPORT_FOLDER = ".scenity/exports";

/** Run `export` with the arguments after the command name. */
export async function runExportCli(argv: readonly string[]): Promise<CliResult> {
  const rest = [...argv];
  const outAt = rest.indexOf("--out");
  const out = outAt < 0 ? undefined : rest.splice(outAt, 2)[1];
  const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
  const [dir, scene, ...extra] = rest.filter((arg) => !arg.startsWith("--"));
  const unknown = [...flags].some((flag) => flag !== "--no-import" && flag !== "--json");
  if (dir === undefined || scene === undefined || extra.length > 0 || unknown || (outAt >= 0 && out === undefined))
    return { out: [`usage: ${EXPORT_USAGE}`], code: 2 };
  let result: SceneExport;
  try {
    result = await exportScene(dir, scene, { runImports: !flags.has("--no-import") });
  } catch (error) {
    if (error instanceof ProjectReadError || error instanceof ExportError) return { out: [error.message], code: 2 };
    throw error;
  }
  const file = resolve(out ?? join(dir, EXPORT_FOLDER, `${result.scene.id}.glb`));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.glb);
  const near = relative(process.cwd(), file);
  const shown = near.startsWith("..") ? toPosix(file) : toPosix(near);
  const entities = Object.keys(result.scene.entities).length;
  if (flags.has("--json")) {
    const report = { file: shown, bytes: result.glb.byteLength, entities, models: result.models };
    return { out: [JSON.stringify({ ...report, warnings: result.warnings }, null, 2)], code: 0 };
  }
  const lines = result.warnings.map((warning) => `warning: ${warning}`);
  lines.push(
    `${result.sceneFile}: ${String(entities)} entities, ${String(Object.keys(result.models).length)} models → ` +
      `${shown} (${String(result.glb.byteLength)} bytes)`,
  );
  return { out: lines, code: 0 };
}
