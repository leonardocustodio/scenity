// SPDX-License-Identifier: Apache-2.0
/**
 * The sources of the parts of the studio. In a checkout the host runs the editor app
 * (`apps/editor`) and the CLI source (`packages/cli`) of that checkout. An installed host (the package
 * `@scenity/studio-host` from npm) runs the packages `@scenity/editor` and `@scenity/cli` that it depends on.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** The scene page config of the editor app. */
export const SCENE_CONFIG = "vite.scene.config.ts";

/** The folder of this package. */
const PACKAGE_DIR = resolve(import.meta.dir, "..");

/** The Scenity checkout that holds this package, or null for an installed package. */
export function checkoutRoot(packageDir: string = PACKAGE_DIR): string | null {
  const root = resolve(packageDir, "..", "..");
  return existsSync(join(root, "apps", "editor", SCENE_CONFIG)) && existsSync(join(root, "packages", "cli"))
    ? root
    : null;
}

/** The folder of an installed package (its package.json), from this package. */
function packageFolder(name: string, from: string = PACKAGE_DIR): string {
  return dirname(createRequire(join(from, "package.json")).resolve(`${name}/package.json`));
}

/** The folder of the editor app that the studio runs. */
export function editorAppDir(checkout: string | null = checkoutRoot()): string {
  const app = checkout === null ? packageFolder("@scenity/editor") : join(checkout, "apps", "editor");
  if (!existsSync(join(app, SCENE_CONFIG))) throw new Error(`no scene page config at ${join(app, SCENE_CONFIG)}`);
  return app;
}

/** The `bun` program for the children of the host. */
export function bunPath(): string {
  return process.execPath;
}

/** The command line of the `scenity` CLI: the source of the checkout, or the bin of the installed `@scenity/cli`. */
export function cliCommand(checkout: string | null = checkoutRoot()): string[] {
  if (checkout !== null) return [bunPath(), join(checkout, "packages", "cli", "src", "cli.ts")];
  const dir = packageFolder("@scenity/cli");
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { bin?: Record<string, string> };
  return [bunPath(), join(dir, manifest.bin?.scenity ?? "src/cli.ts")];
}

/** The `vite` program of the editor app (its own dependency), for the scene server. */
export function viteCommand(app: string): string[] {
  return [bunPath(), join(packageFolder("vite", app), "bin", "vite.js")];
}
