// SPDX-License-Identifier: Apache-2.0
/**
 * The project folder of a command and the Scenity checkout of the CLI.
 *
 * The project folder of a command is `--project`, else the work folder when it has `scenity.project.json`, else the
 * `scenity.project` field of the nearest package.json (the rule of the editor).
 *
 * The checkout is the Bun workspace that holds this package. A project outside the checkout links the packages
 * (`bun link`, then a `link:` dependency): Bun gives the real path of a linked package, so the CLI always finds the
 * checkout above its own folder. `SCENITY_CHECKOUT` names another checkout. An installed command has no checkout:
 * the scene page dev server comes from the package `@scenity/editor` of the project.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROJECT_FILE } from "@scenity/scene";
import { defaultProjectDir } from "./vite/resolve";

/** The variable that names the checkout of Scenity (a folder with the workspace package.json). */
export const CHECKOUT_ENV = "SCENITY_CHECKOUT";

/** A setup problem of a command: no project, no editor. */
export class CommandSetupError extends Error {}

/** True when a folder holds a project document. */
export function isProjectDir(dir: string): boolean {
  return existsSync(join(dir, PROJECT_FILE));
}

/** The project folder of a command (absolute). Throws a `CommandSetupError` when there is none. */
export function commandProjectDir(explicit: string | undefined, from: string = process.cwd()): string {
  if (explicit !== undefined) {
    const dir = resolve(from, explicit);
    if (!isProjectDir(dir)) throw new CommandSetupError(`${dir} has no ${PROJECT_FILE}.`);
    return dir;
  }
  if (isProjectDir(from)) return resolve(from);
  const fallback = defaultProjectDir(from);
  if (fallback !== null && isProjectDir(fallback)) return fallback;
  throw new CommandSetupError(
    `${resolve(from)} has no ${PROJECT_FILE}: run the command in a project, or give --project.`,
  );
}

function hasWorkspaces(dir: string): boolean {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown }).workspaces !== undefined;
  } catch {
    return false;
  }
}

/** The checkout of Scenity that holds the CLI (the folder with the workspace package.json), or null. */
export function checkoutRoot(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const named = env[CHECKOUT_ENV];
  if (named !== undefined && named !== "") return hasWorkspaces(named) ? resolve(named) : null;
  for (let dir = realpathSync(import.meta.dir); ; dir = dirname(dir)) {
    if (hasWorkspaces(dir) && existsSync(join(dir, "packages", "cli", "package.json"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** The package of the editor: the scene page, its dev server config and the play window. */
export const EDITOR_PACKAGE = "@scenity/editor";
/** The dev server config of the scene page in the editor folder. */
export const SCENE_CONFIG = "vite.scene.config.ts";

/** The folder of the installed editor package, resolved from the first folder that has it, or null. */
export function installedEditorDir(from: readonly string[]): string | null {
  for (const dir of from) {
    try {
      return dirname(realpathSync(Bun.resolveSync(`${EDITOR_PACKAGE}/package.json`, dir)));
    } catch {
      // The package is not under this folder: try the next folder.
    }
  }
  return null;
}

/**
 * The editor of the scene page dev server. A command of a checkout uses the editor app of the same checkout
 * (`apps/editor`), so the CLI and the editor have the same source. An installed command uses the package
 * `@scenity/editor` of the project, else the package next to the command.
 */
export function editorAppDir(projectDir: string): string {
  const checkout = checkoutRoot();
  const dir = checkout === null ? installedEditorDir([projectDir, import.meta.dir]) : join(checkout, "apps", "editor");
  if (dir === null) {
    throw new CommandSetupError(
      `The scene page dev server needs the package ${EDITOR_PACKAGE}: add it to the project ` +
        `(bun add ${EDITOR_PACKAGE}), or set ${CHECKOUT_ENV} to a checkout of Scenity.`,
    );
  }
  if (!existsSync(join(dir, SCENE_CONFIG))) {
    throw new CommandSetupError(`${dir} has no ${SCENE_CONFIG} (the scene page of the editor).`);
  }
  return dir;
}
