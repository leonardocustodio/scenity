// SPDX-License-Identifier: Apache-2.0
/**
 * The one scene server of the studio: the Vite of the editor app with the scene
 * config, as a child of the host. It serves the Hub page, the editor pages and the player pages of every open project.
 * It reads the open projects from the projects file of the host. The host forwards every page path to it (proxy.ts).
 * An installed host keeps the dependency cache of Vite in its state folder, not in the installed editor package.
 */
import { childEnv, ServerChild, type ChildCommand } from "./process";
import { checkoutRoot, editorAppDir, SCENE_CONFIG, viteCommand } from "./runtime";

export { editorAppDir } from "./runtime";

/** The variable of the projects file of the scene server (apps/editor `scripts/projectsFile.ts`). */
export const PROJECTS_FILE_ENV = "SCENITY_SCENE_PROJECTS_FILE";
/** The variable of the dependency cache folder of the scene server (apps/editor `vite.scene.config.ts`). */
export const SCENE_CACHE_ENV = "SCENITY_SCENE_CACHE_DIR";

export interface SceneServerOptions {
  /** The dependency cache folder of Vite; none keeps the default of the config. */
  readonly cacheDir?: string | undefined;
  readonly port?: number | undefined;
}

/** The command of the scene server on a port, with the projects file. */
export function sceneServerCommand(app: string, projectsFile: string, port: number, cacheDir?: string): ChildCommand {
  const [bun = "bun", ...vite] = viteCommand(app);
  return {
    cmd: [bun, ...vite, "--config", SCENE_CONFIG, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    cwd: app,
    env: childEnv({
      [PROJECTS_FILE_ENV]: projectsFile,
      ...(cacheDir === undefined ? {} : { [SCENE_CACHE_ENV]: cacheDir }),
    }),
  };
}

/** The scene server of the studio. */
export function studioSceneServer(
  projectsFile: string,
  app: string = editorAppDir(),
  options: SceneServerOptions = {},
): ServerChild {
  return new ServerChild({
    command: (free) => sceneServerCommand(app, projectsFile, free, options.cacheDir),
    readyPath: "/scene.html",
    ...(options.port === undefined ? {} : { port: options.port }),
  });
}

/** The cache folder of an installed host (in its state folder); a checkout keeps the cache of its editor app. */
export function sceneCacheDir(stateDir: string): string | undefined {
  return checkoutRoot() === null ? `${stateDir}/vite-scene` : undefined;
}
