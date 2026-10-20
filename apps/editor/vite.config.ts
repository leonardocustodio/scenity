// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { envValue } from "@scenity/labs-platform/envNames";
import { defineConfig } from "vite";
import { threeDiet } from "../../packages/assets/src/build/threeDiet.ts";
import { loadEditorProject, writeEditorFiles } from "../../packages/cli/src/vite/editor.ts";
import { scenityPlugins } from "../../packages/cli/src/vite/plugins.ts";
import { defaultProjectDir, isInside } from "../../packages/cli/src/vite/resolve.ts";
import { scenityAssetApi } from "./scripts/assetApiServer.ts";
import { labsContentHash } from "./scripts/labsContentHash.ts";
import { labsCsp } from "./scripts/labsCsp.ts";
import { labFsOptions, projectWorkspace } from "./scripts/labsFs.ts";
import { labsGate } from "./scripts/labsGate.ts";
import { labsStills } from "./scripts/labsStills.ts";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const zstdStub = fileURLToPath(new URL("../../packages/render/src/vendor/zstdStub.ts", import.meta.url));

/**
 * The project of the lab is the default project of the workspace (the `scenity.project` field of the root
 * package.json). The editor config faces of its plugins give the Vite parts of the plugins: plugins of the page and of
 * the workers, aliases, the proxy, served folders, styles, the content files of the frame key and the pictures of the
 * content browser. The config writes the plugin list and the style list of the page (src/generated) from the project.
 * Thus the editor app names no plugin.
 *
 * `SCENITY_PROJECT` points the editor at a project outside the checkout (for example the room project of CodeBlue).
 * The generated files of that project go to its state folder (`<project>/.scenity/editor`). Thus a run does not change
 * the files of the checkout. Two aliases give the generated files to the page. A checkout with no project opens an
 * empty project, and the lab page then has no editor plugin.
 */
const EMPTY_PROJECT = fileURLToPath(new URL("./scripts/emptyProject", import.meta.url));
const labProject = defaultProjectDir(workspaceRoot) ?? EMPTY_PROJECT;
const editor = await loadEditorProject(labProject, { env: process.env, root: workspaceRoot });
const inCheckout = isInside(labProject, workspaceRoot);
const generatedDir = inCheckout
  ? fileURLToPath(new URL("./src/generated/", import.meta.url))
  : join(labProject, ".scenity", "editor");
writeEditorFiles(editor, generatedDir);
// The workspace of a project outside the checkout: the server serves it.
const servedProject = inCheckout ? [] : [projectWorkspace(labProject)];
const generatedAliases = inCheckout
  ? []
  : [
      { find: /^\.\/generated\/editorPlugins$/, replacement: join(generatedDir, "editorPlugins.ts") },
      { find: /^\.\/generated\/editorStyles\.css$/, replacement: join(generatedDir, "editorStyles.css") },
    ];

/**
 * The labs app: the lab page of the 3D room and its tools. Every build of it has the lab tools of the renderer
 * (`__ROOM3D_LAB__`). A runtime user (the player) never has them.
 */
export default defineConfig({
  define: {
    __ROOM3D_LAB__: "true",
    // The key of this checkout (a hash of its folder). Only the lab page saves its split screen under this key.
    __LABS_CHECKOUT__: JSON.stringify(createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12)),
  },
  plugins: [
    // In the remote mode, the server refuses each request without the gate key of the gateway. This plugin is first.
    labsGate(),
    // The Content-Security-Policy header of the dev server (the CSP of the lab frames of the workbench).
    labsCsp(),
    // The content hash of the frames: the key of the strip and of the index.
    labsContentHash(editor.config.content),
    // The URLs of the pictures of the content browser in one module.
    labsStills(editor.config.stills),
    // The three.js of the learner app, without environment maps and WebXR.
    threeDiet(),
    // The plugins of the editor config faces of the project plugins.
    ...editor.config.plugins,
    // The asset list and the import of the core tab "Assets" of the dock, for the project of the lab.
    scenityAssetApi({ lab: labProject }),
    // `virtual:scenity/plugins` with the runtime faces of the project plugins (src/plugins.ts).
    scenityPlugins({ project: labProject }),
    vue(),
    tailwindcss(),
  ],
  resolve: {
    // A project outside the checkout has its own copy of these packages. The page and the workers use one copy.
    dedupe: ["three", "vue", "zod"],
    alias: [
      // The aliases of the editor config faces of the project plugins.
      ...editor.config.alias,
      // The generated files of a project outside the checkout.
      ...generatedAliases,
      // The Zstandard decoder of three.js never runs: every KTX2 image is Basis Universal.
      { find: /^\.\.\/libs\/zstddec\.module\.js$/, replacement: zstdStub },
    ],
  },
  // The dependency scan reads the pages of this config only. The scene page (scene.html) imports the module
  // `virtual:scenity/project-plugins` of vite.scene.config.ts. Thus a scan of it fails and Vite skips the pre-bundle.
  // The first page then finds the dependencies and Vite reloads it. But the server of the lab tools has no HMR. The
  // page keeps the old dependencies ("504 Outdated Optimize Dep"), and the tool waits for the page until its timeout.
  optimizeDeps: { entries: ["index.html", "still.html"] },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    // The tools of the lab (scripts/lab) start their own server with no file watch and no reload. Thus an edit during
    // a run does not reload the page under a measurement.
    ...(envValue("SCENITY_LAB_TOOLS") === "1" ? { watch: null, hmr: false } : {}),
    // The local mode serves the workspace. The remote mode of the workbench host serves only the folders that the lab
    // page loads. Both modes deny the secret files (scripts/labsFs.ts).
    fs: labFsOptions(process.env, workspaceRoot, editor.config.fsAllow, servedProject),
    // The proxy rules of the editor config faces (for example the engine of a mock source).
    proxy: editor.config.proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
  },
  // The render worker also gets the three.js of the learner app and the worker plugins of the editor config faces. The
  // workers stay IIFE files: they import the runtime face of the room statically. The ES format would make chunks of
  // their lazy imports.
  worker: { plugins: () => [threeDiet(), ...editor.config.workerPlugins()] },
  build: {
    target: "es2023",
    sourcemap: true,
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.vitest.ts"],
    // Each test file starts with the plugin of the editor registered (tests/setup.ts).
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    testTimeout: 20_000,
  },
});
