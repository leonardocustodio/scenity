// SPDX-License-Identifier: Apache-2.0
/**
 * The scene file port of the scene page: the read and the save of a `*.scene.json` file of the project. The calls have
 * the contract of `@scenity/cli/sceneFileContract`: the workbench host has them as the requests `scene.read` and
 * `scene.save`, and the dev server of the scene page has them for a page with no workbench (scripts/sceneSave.ts: a
 * POST of the save parameters to the URL of the file).
 *
 * The port also gives the scene list of the project and the create of a new scene (scripts/sceneProject.ts;
 * the host request `scene.create`). A save as is a save to a new path with no base hash.
 */
import { sceneTextHash } from "@scenity/editor-core";
import type {
  SceneCreateParams,
  SceneCreateResult,
  SceneFileText,
  SceneSaveParams,
  SceneSaveResult,
} from "@scenity/cli/sceneFileContract";
import { t } from "../texts";

/** One scene file of the project (scripts/sceneProject.ts `ProjectSceneFile`). */
export interface ProjectSceneFile {
  readonly path: string;
  readonly id: string | null;
  readonly name: string | null;
  /** The path of the picture in the project (the poster, else a still of the scene), or null. */
  readonly picture: string | null;
  /** True when the project file lists the scene. */
  readonly listed: boolean;
}

/** The scene list of the project (scripts/sceneProject.ts `ProjectScenes`). */
export interface ProjectScenes {
  readonly id: string;
  readonly name: string;
  readonly scenes: readonly string[];
  readonly files: readonly ProjectSceneFile[];
}

/** The calls of the scene files. */
export interface SceneFilePort {
  read(path: string): Promise<SceneFileText>;
  save(params: SceneSaveParams): Promise<SceneSaveResult>;
  /** Create a new empty scene file. Absent: the page has no New scene. */
  create?(params: SceneCreateParams): Promise<SceneCreateResult>;
  /** The scene list of the project. Absent: the page lists the open scenes only. */
  list?(): Promise<ProjectScenes>;
}

/** The header of a save request: the dev server refuses a POST without it. */
export const SAVE_HEADER = "x-scenity-scene-save";

/** The header of a read: the dev server answers a missing file with 204 (scripts/projects.ts `FILE_READ_HEADER`). */
export const FILE_READ_HEADER = "x-scenity-file-read";

function isSaveResult(value: unknown): value is SceneSaveResult {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

/** The port of the dev server of the scene page for the project at `base` (a URL path that ends with "/"). */
export function devServerFiles(base: string): Required<SceneFilePort> {
  return {
    async read(path) {
      const response = await fetch(`${base}${path}`, { cache: "no-store", headers: { [FILE_READ_HEADER]: "1" } });
      // A missing file gives 204 (scripts/projects.ts), so the browser console shows no failed request.
      if (response.status === 204 || !response.ok) {
        const status = response.status === 204 ? "404" : String(response.status);
        throw new Error(t("scene-error-no-scene", { url: `${base}${path}`, status }));
      }
      const text = await response.text();
      return { path, text, hash: sceneTextHash(text) };
    },
    async save(params) {
      const response = await fetch(`${base}${params.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SAVE_HEADER]: "1" },
        body: JSON.stringify(params),
      });
      const value: unknown = await response.json().catch(() => null);
      if (isSaveResult(value)) return value;
      return {
        ok: false,
        path: params.path,
        conflict: false,
        reason: t("scene-file-save-failed", { status: String(response.status) }),
      };
    },
    async create(params) {
      const response = await fetch(`${base}scenes.create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SAVE_HEADER]: "1" },
        body: JSON.stringify(params),
      });
      const value: unknown = await response.json().catch(() => null);
      if (isSaveResult(value)) return value as unknown as SceneCreateResult;
      return {
        ok: false,
        path: params.path,
        reason: t("scene-file-create-failed", { status: String(response.status) }),
      };
    },
    async list() {
      const response = await fetch(`${base}scenes.list.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(t("scene-error-no-scene-list", { base, status: String(response.status) }));
      return (await response.json()) as ProjectScenes;
    },
  };
}
