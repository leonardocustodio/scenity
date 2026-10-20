// SPDX-License-Identifier: Apache-2.0
/**
 * The routes of the Project settings window on the dev server, under the folder of the project, and the checks of the
 * server. The page (projectCalls.ts) and the server (scripts/projectSettingsApi.ts) share this module; it has no
 * import, so the config loader of Vite reads it.
 */

/** The path of the read. */
export const PROJECT_SETTINGS_PATH = "project.settings.json";
/** The path of the write. */
export const PROJECT_SETTINGS_WRITE_PATH = "project.settings.write";

/** A check of the server: a schema issue of the reader, or a file of a list that is not in the project. */
export interface ServerCheck {
  readonly path: string;
  /** "schema": the reader refuses the value; "missing": no file or folder at the path. */
  readonly kind: "schema" | "missing";
  /** The message of the reader, or the missing path. */
  readonly detail: string;
}
