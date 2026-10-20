// SPDX-License-Identifier: Apache-2.0
/**
 * The scene page as a workbench surface: a scene surface of a project
 * manifest runs the scene page of the editor (apps/editor `scene.html`, the Vite config `vite.scene.config.ts`) on a
 * scene server of the project, not the lab page. The page serves the workbench bridge, so the host tools reach it.
 *
 * - A surface of the kind `scene` whose `page` is the scene page, or a surface with no page that no host plugin gives
 *   (the surfaces of the manifest), runs the scene page. A surface of a plugin with no page (the lab of the room
 *   plugin) stays on the editor server.
 * - The start page is `/scene.html?project=<id>&edit=1`: the edit mode with the commands, the proposals and the save.
 *   The start page opens the first scene of the project file (`scene=`), so the tools reach a scene immediately.
 *   The scene switcher of the file bar opens the project start screen.
 * - The scene server serves the project folder under its ID (`SCENITY_SCENE_PROJECTS` of apps/editor
 *   `scripts/assetReload.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_KEY_ENV, newLabKey } from "@scenity/labs-platform/labKey";
import type { HostProject } from "./project";
import type { ProjectSurfaceInfo } from "./protocol";
import { bunPath } from "./hostRuntime";
import { childEnv, LAB_APP, labRoot, type ServerCommand } from "./servers";

/** The kind of the scene server of a project (the Vite of apps/editor with the scene config). */
export const SCENE_SERVER = "scene";
/** The path of the scene page on the scene server. */
export const SCENE_PAGE = "/scene.html";
/** The Vite config of the scene page in apps/editor. */
export const SCENE_CONFIG = "vite.scene.config.ts";
/** The variable of the projects of the scene server (apps/editor `scripts/assetReload.ts`). */
export const SCENE_PROJECTS_ENV = "SCENITY_SCENE_PROJECTS";

/** The name of a project on the scene page: its ID when it is a valid page name, else "project". */
export function scenePageName(id: string): string {
  return /^[a-z0-9-]+$/.test(id) ? id : "project";
}

/** True when a page path is the scene page. */
export function isScenePage(page: string | null): boolean {
  return page !== null && new URL(page, "http://page.invalid").pathname === SCENE_PAGE;
}

/** True when the surface of a project runs the scene page. */
export function runsScenePage(project: HostProject, surface: ProjectSurfaceInfo): boolean {
  if (isScenePage(surface.page)) return true;
  if (surface.page !== null || project.manifest === null) return false;
  return !project.plugins.some((plugin) => (plugin.surfaces ?? []).some((item) => item.id === surface.id));
}

/** The first scene of a project file, or null (no file, no scene list, or a file that does not read). */
function firstScene(manifest: string | null): string | null {
  if (manifest === null) return null;
  try {
    const doc = JSON.parse(readFileSync(manifest, "utf8")) as { scenes?: unknown };
    const [first] = Array.isArray(doc.scenes) ? (doc.scenes as unknown[]) : [];
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
}

/**
 * The start page of a scene page surface: its page with the project name, else the edit mode of the project. The
 * edit mode opens the first scene of the project file. A project with no scene gets the start screen.
 */
export function scenePagePath(project: HostProject, surface: ProjectSurfaceInfo): string {
  const url = new URL(surface.page ?? `${SCENE_PAGE}?edit=1`, "http://page.invalid");
  if (!url.searchParams.has("project")) url.searchParams.set("project", scenePageName(project.id));
  const scene = surface.page === null ? firstScene(project.manifest) : null;
  if (scene !== null && !url.searchParams.has("scene")) url.searchParams.set("scene", scene);
  return `${url.pathname}${url.search}`;
}

/** The ID of the manifest of a project folder, or "project". */
function projectId(dir: string): string {
  try {
    const doc = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { id?: unknown };
    return typeof doc.id === "string" ? doc.id : "project";
  } catch {
    return "project";
  }
}

/**
 * The scene server of a project folder on a port: the Vite of apps/editor with the scene config, with the project
 * folder under its page name. A project folder with no labs app uses the labs app of the host source (`labRoot`).
 */
export function scenePageCommand(projectDir: string, port: number): ServerCommand {
  const app = join(labRoot(projectDir), LAB_APP);
  if (!existsSync(join(app, SCENE_CONFIG))) throw new Error(`No scene page config at ${join(app, SCENE_CONFIG)}.`);
  const config = ["--config", SCENE_CONFIG];
  return {
    cmd: [bunPath(), "x", "--bun", "vite", ...config, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    cwd: app,
    env: childEnv({
      [SCENE_PROJECTS_ENV]: `${scenePageName(projectId(projectDir))}=${projectDir}`,
      [LAB_KEY_ENV]: newLabKey(),
    }),
  };
}
