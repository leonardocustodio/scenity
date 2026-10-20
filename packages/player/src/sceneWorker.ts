// SPDX-License-Identifier: Apache-2.0
/**
 * The scene worker of the player: the generic scene worker of the runtime with the project plugins of the build.
 * `virtual:scenity/plugins` is the plugin module of the build. `scenity build` gives the plugins of its project
 * (`@scenity/cli/vite`). The scene server of the editor gives the plugins of the project that the player names
 * (`plugins` option, `init.plugins`). Each plugin is an ES chunk of the worker build, so the plugins share the
 * three.js and the runtime of the worker. The page sends no code and no module URL.
 */
import { attachDocumentWorker } from "@scenity/runtime/documentWorker";
import { loadPlugins } from "virtual:scenity/plugins";

attachDocumentWorker(self, (set) => loadPlugins(set));
