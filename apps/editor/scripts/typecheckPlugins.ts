// SPDX-License-Identifier: Apache-2.0
/**
 * The type check of the editor faces of the project plugins: `vue-tsc --noEmit -p <plugin>/tsconfig.json`
 * for each plugin of the default project of the workspace (the `scenity.project` field of the root package.json) with
 * an editor face and a tsconfig.json. The `typecheck` script of the editor runs it after the check of the app. An
 * editor face imports the editor core (Vite types), so the check of the repo root does not read it.
 *
 * Run from apps/editor: `bun scripts/typecheckPlugins.ts` (exit 1 when a check fails).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { defaultProjectDir, resolveProjectPlugins } from "@scenity/cli/plugins";

const ROOT = join(import.meta.dir, "..", "..", "..");

/** The tsconfig.json files of the plugins of the default project that have an editor face. */
export async function pluginConfigs(root: string = ROOT): Promise<string[]> {
  const projectDir = defaultProjectDir(root);
  if (projectDir === null) return [];
  const { plugins } = await resolveProjectPlugins(projectDir);
  return plugins
    .filter((plugin) => plugin.editor !== undefined)
    .map((plugin) => join(plugin.dir, "tsconfig.json"))
    .filter((file) => existsSync(file));
}

if (import.meta.main) {
  let failed = false;
  for (const config of await pluginConfigs()) {
    const path = relative(process.cwd(), config);
    const child = spawnSync("vue-tsc", ["--noEmit", "-p", path], { stdio: "inherit" });
    if (child.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
