// SPDX-License-Identifier: Apache-2.0
/**
 * The calls of the Project settings window to the dev server (scripts/projectSettingsApi.ts): read the project file
 * with its JSON Schema, and write a new project value.
 */
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { PROJECT_SETTINGS_PATH, PROJECT_SETTINGS_WRITE_PATH, type ServerCheck } from "./projectRoutes";

export type { ServerCheck } from "./projectRoutes";

/** The answer of a read. */
export interface ProjectSettings {
  readonly file: string;
  readonly project: unknown;
  readonly schema: unknown;
  readonly checks: readonly ServerCheck[];
}

/** The answer of a write. */
export type WriteAnswer =
  | { readonly ok: true; readonly checks: readonly ServerCheck[] }
  | { readonly ok: false; readonly checks: readonly ServerCheck[]; readonly reason?: string };

/** Read the project settings of the project folder `base` (its URL, with a "/" at the end). */
export async function readProjectSettings(base: string): Promise<ProjectSettings> {
  const response = await fetch(`${base}${PROJECT_SETTINGS_PATH}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`);
  return (await response.json()) as ProjectSettings;
}

/** Write a new project value. */
export async function writeProjectSettings(base: string, project: unknown): Promise<WriteAnswer> {
  const response = await fetch(`${base}${PROJECT_SETTINGS_WRITE_PATH}`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  });
  return (await response.json()) as WriteAnswer;
}
