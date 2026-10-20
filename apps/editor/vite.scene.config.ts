// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { envValue } from "@scenity/labs-platform/envNames";
import { scenityAssetApi } from "./scripts/assetApiServer.ts";
import { scenityApprovalsApi } from "./scripts/approvalsApi.ts";
import { scenityAssetTools } from "./scripts/assetTools.ts";
import { scenityBenchApi } from "./scripts/benchApi.ts";
import { scenityCheckApi } from "./scripts/checkApi.ts";
import { scenityExportApi } from "./scripts/exportApi.ts";
import { scenityGeneratorsApi } from "./scripts/generatorsApi.ts";
import { scenityPoolApi } from "./scripts/poolApi.ts";
import { scenityProjectBuildApi } from "./scripts/projectBuildApi.ts";
import { scenityProjectSettingsApi } from "./scripts/projectSettingsApi.ts";
import { scenityVcsApi } from "./scripts/vcsApi.ts";
import { scenityJobsApi } from "./scripts/jobsApi.ts";
import { scenityDraftsApi } from "./scripts/draftsApi.ts";
import { scenityPluginsApi } from "./scripts/pluginsApi.ts";
import { scenityPluginSettingsApi } from "./scripts/pluginSettingsApi.ts";
import { scenityRenderQueueApi } from "./scripts/renderQueueApi.ts";
import { scenityFrameIndexApi } from "./scripts/frameIndexApi.ts";
import { scenityShotsApi } from "./scripts/shotsApi.ts";
import { scenitySourcesApi } from "./scripts/sourcesApi.ts";
import { scenityBuildApi } from "./scripts/buildApiServer.ts";
import { scenityReleaseApi } from "./scripts/releaseApi.ts";
import { scenityRulesApi } from "./scripts/rulesApi.ts";
import { scenityRightsApi } from "./scripts/rightsApi.ts";
import { scenityStillsApi } from "./scripts/stillsApiServer.ts";
import { scenityProjectFiles } from "./scripts/projectFilesServer.ts";
import { projectsFromEnv, scenityAssetReload, SCENE_PROJECTS_ENV } from "./scripts/assetReload.ts";
import { PROJECTS_FILE_ENV, readProjectsFile, scenityProjectsFile } from "./scripts/projectsFile.ts";
import { labsCsp } from "./scripts/labsCsp.ts";
import { scenityProjects } from "./scripts/projects.ts";
import { sceneProjectPlugins } from "./scripts/sceneProjectPlugins.ts";
import { sceneDependencies, scenityPackages } from "./scripts/scenityDeps.ts";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
/** The package.json of the editor: the Scenity packages and the modules of the dependency step come from it. */
const manifest = fileURLToPath(new URL("./package.json", import.meta.url));
/**
 * The samples of the checkout. An installed editor (`node_modules/@scenity/editor`) has no samples folder. It
 * serves only the projects of the environment (the project that `scenity dev` opens).
 */
const samplesDir = `${workspaceRoot}samples`;
const inCheckout = !/[\\/]node_modules[\\/]/.test(fileURLToPath(import.meta.url)) && existsSync(samplesDir);

// The samples of the checkout:
// - characters: a rigged robot that walks, stops and waves through its animator;
// - gltf-samples: the Khronos glTF samples of the extensions of the generic loader;
// - spin: a scene with a project plugin (samples/spin/plugins/demo) in the page, the worker and the player;
// - physics: the physics plugin (Rapier) with crates, a ball, a ramp and a character;
// - walkthrough: two robots and a mannequin walk, meet, pick up and wave;
// - sim-road: a road crossing with the traffic simulation.
const SAMPLES = ["showroom", "characters", "gltf-samples", "spin", "physics", "walkthrough", "sim-road"] as const;
const samples = inCheckout ? Object.fromEntries(SAMPLES.map((name) => [name, `${samplesDir}/${name}`])) : {};

// More projects come from the environment (a test, and the project of `scenity dev`). The open projects of the studio
// host come from the file that `SCENITY_SCENE_PROJECTS_FILE` names. The dev server watches this file.
const projectsFile = envValue(PROJECTS_FILE_ENV);
const projects: Record<string, string> = {
  ...samples,
  ...projectsFromEnv(envValue(SCENE_PROJECTS_ENV)),
  ...(projectsFile === undefined ? {} : readProjectsFile(projectsFile).projects),
};

/** The build inputs of the plain HTML pages of the player: the samples of the checkout only. */
const playerPages: Record<string, string> = inCheckout
  ? Object.fromEntries(
      SAMPLES.filter((name) => name !== "gltf-samples").map((name) => [
        `player-${name}`,
        fileURLToPath(new URL(`./player/${name}.html`, import.meta.url)),
      ]),
    )
  : {};

/**
 * The scene page of the editor: a scene document of a Scenity project, drawn by the scene builder of @scenity/runtime.
 * This build has the whole three.js: a generic scene can have environment maps and any material and light. Thus the
 * `threeDiet` plugin of the lab build does not apply.
 *
 *   bunx --bun vite --config vite.scene.config.ts          (in apps/editor; then /scene.html?project=showroom)
 *
 * The dev server swaps a changed asset into the open scene with no page reload (scripts/assetReload.ts).
 */
export default defineConfig({
  // The scene page has its own dependency cache. The lab server (vite.config.ts) runs in the same folder with other
  // dependencies. With one shared cache, each server optimizes again and the other gets "Outdated Optimize Dep" answers
  // (a workbench host runs both servers at the same time).
  // An installed studio host keeps the cache in its state folder (SCENITY_SCENE_CACHE_DIR), not in the
  // installed editor package.
  cacheDir: envValue("SCENITY_SCENE_CACHE_DIR") ?? "node_modules/.vite-scene",
  // The scene server has no fallback page: a request for a file that is not there gets 404. With the SPA fallback, a
  // missing file gives the lab page (index.html), and Vite then makes the lab modules (`virtual:labs-content-hash`).
  appType: "mpa",
  optimizeDeps: {
    // The scan reads the pages of this config only. The lab page (index.html) needs the lab config.
    entries: ["scene.html", "hub.html", "player/*.html"],
    // Vite reads the Scenity packages as source, also from node_modules (scripts/scenityDeps.ts).
    exclude: scenityPackages(manifest),
    // The first bundle holds the modules that only the Scenity packages import, so a first load does not reload the
    // page in the middle of an edit (scripts/scenityDeps.ts).
    include: sceneDependencies(manifest),
  },
  // The faces of the plugins import "vue", "zod", "three" and the engine packages from their own folders. They take
  // the copies of the editor. Thus a folder plugin of a project with no node_modules works, and the page has one Vue
  // and one engine. `@scenity/editor/studio` is the studio API of this editor.
  resolve: {
    dedupe: ["vue", "zod", "three", "@scenity/scene", "@scenity/runtime", "@scenity/rules", "@scenity/i18n"],
    alias: { "@scenity/editor/studio": fileURLToPath(new URL("./src/studio/extensions/api.ts", import.meta.url)) },
  },
  plugins: [
    // The open projects of the studio host. This plugin changes the project record that the plugins below read.
    scenityProjectsFile(projects, projectsFile),
    labsCsp(),
    // The hot reload of assets in dev. This plugin comes before scenityProjects, which answers the project requests.
    scenityAssetReload(projects),
    // The asset list and the import of the asset browser. This plugin comes before scenityProjects too.
    scenityAssetApi(projects),
    // The stills that the editor page draws, and the decoders of the still page.
    scenityStillsApi(projects),
    // The asset build panel: the build state of each asset, a run of the build, the build settings.
    scenityBuildApi(projects),
    // The licence policy of the project and the rights of many assets.
    scenityRightsApi(projects),
    // The review queue of each approval role, a review, a new role.
    scenityApprovalsApi(projects),
    // A run of the release gate for the release check panel.
    scenityReleaseApi(projects),
    // The problems of the asset database with their fixes (relink, a new ID).
    scenityAssetTools(projects),
    // The GLB export of a scene, with the glTF validator.
    scenityExportApi(projects),
    // The asset sources (Poly Haven): a search, the previews and an import with the rights record.
    scenitySourcesApi(projects),
    // The generators of assets (a service of SCENITY_GENERATOR_URL): the cost first, then a run.
    scenityGeneratorsApi(projects),
    // The rules of the project file and of the rules files (the rules editor).
    scenityRulesApi(projects),
    // The check job (`scenity check --json`) for the Problems panel.
    scenityCheckApi(projects),
    // The bench runner (`scenity bench --json`) and the history of its reports.
    scenityBenchApi(projects),
    // The Build window (`scenity build --json`, the report, the size budgets of the entries).
    scenityProjectBuildApi(projects),
    // The shots, the baselines, the verify job and a poster from a shot.
    scenityShotsApi(projects),
    // The render queue of sheets and clips.
    scenityRenderQueueApi(projects),
    scenityFrameIndexApi(projects),
    // The scene pool controls of Preferences → Advanced.
    scenityPoolApi(),
    // The Project settings window (the project file as a form from its schema).
    scenityProjectSettingsApi(projects),
    // The version control panel (the changes, the diffs, the commit by the owner, the branches).
    scenityVcsApi(projects),
    // The Jobs panel (the journal of the jobs, run again, stop) and the runs of the project.
    scenityJobsApi(projects),
    // The drafts of the scene files on the host.
    scenityDraftsApi(projects),
    // The Plugins window (the plugins of the project, add and remove).
    scenityPluginsApi(projects),
    // The project settings of the plugins (`.scenity/plugin-settings.json`).
    scenityPluginSettingsApi(projects),
    // The files of the project for the Project window: the list, a move, a new folder, a reveal.
    scenityProjectFiles(projects),
    scenityProjects(projects),
    // The runtime faces of the project plugins (their components go to the inspector of the edit mode).
    sceneProjectPlugins(projects),
    // The inspector panel of the edit mode is Vue with the token classes of the ui package (a lazy chunk).
    vue(),
    tailwindcss(),
  ],
  // The generic scene worker imports the Draco decoder as a chunk, and an IIFE worker has no chunks. The scene worker
  // and the player worker load the project plugins as chunks of the worker build.
  worker: { format: "es", plugins: () => [sceneProjectPlugins(projects)] },
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: false,
    // An e2e spec on a copy of a project disables the watch (SCENITY_SCENE_NO_WATCH=1). Then an edit of the
    // source by another tool does not reload the page in the middle of the test.
    ...(envValue("SCENITY_SCENE_NO_WATCH") === "1" ? { hmr: false, watch: null } : {}),
  },
  build: {
    target: "es2023",
    sourcemap: true,
    rollupOptions: {
      input: {
        scene: fileURLToPath(new URL("./scene.html", import.meta.url)),
        // The Hub of Scenity Studio (the studio host serves it at "/").
        hub: fileURLToPath(new URL("./hub.html", import.meta.url)),
        // The plain HTML pages of the player of the samples (the web component
        // <scenity-player>, no editor code), each with the plugins of its sample.
        ...playerPages,
        // The play window of the scene page (the documents come from a handoff of the scene page).
        "player-play": fileURLToPath(new URL("./player/play.html", import.meta.url)),
      },
    },
  },
});
