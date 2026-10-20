// SPDX-License-Identifier: Apache-2.0
/**
 * The worker of the scene page: the dev scene worker of `@scenity/runtime-dev` with the plugin loader of the page
 * build. The page names its project in the "init" message (`init.plugins`); the worker loads the runtime faces of the
 * plugins of that project from `virtual:scenity/project-plugins` (scripts/sceneProjectPlugins.ts). Each plugin is an ES
 * chunk of the worker build, so the plugins share the three.js and the runtime of the worker. The page sends no code
 * and no module URL. The worker also loads the metric faces of the plugins, so the rule check knows their metrics.
 */
import { attachDevSceneWorker } from "@scenity/runtime-dev/document/attachWorker";
import { loadProjectDevPlugins, loadProjectPlugins } from "virtual:scenity/project-plugins";

attachDevSceneWorker(
  self,
  (project) => (project === undefined ? Promise.resolve([]) : loadProjectPlugins(project)),
  (project) => (project === undefined ? Promise.resolve([]) : loadProjectDevPlugins(project)),
);
