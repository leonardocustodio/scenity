// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { ciWaitMs } from "./tests/support/ci-timing";

// The visual baselines of the editor: each frame of the samples on the scene page against its baseline. The web server
// builds the scene page into a cache folder. It serves the build with the gallery server
// scripts/static/gallery-server.ts on a free port. Run: bun run test:gallery (in apps/editor).
// Update the macOS baselines: bun run test:gallery --update-snapshots. Update the Linux baselines in the Playwright
// image of CI: scripts/gallery-linux-baselines.sh update. The editor face of a plugin runs the gallery of its lab page
// with its own config. That config imports GALLERY_BASE and LAB_GALLERY_SERVER of this file.

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// The workers load this file again; they take the port of the main process from the environment.
// The dev servers of the gallery keep no drafts on the host, so a frame never shows the edits of another frame.
process.env.SCENITY_SCENE_HOST_DRAFTS ??= "0";
process.env.CB_GALLERY_PORT ??= String(await freePort());
const port = Number(process.env.CB_GALLERY_PORT);
// The scene page build (vite.scene.config.ts) on a second port.
process.env.CB_GALLERY_SCENE_PORT ??= String(await freePort());
const scenePort = Number(process.env.CB_GALLERY_SCENE_PORT);
const sceneOutDir = "node_modules/.cache/scenity-scene-gallery";
// The build folder of the gallery (Git and the linters ignore node_modules/.cache).
const outDir = process.env.CB_GALLERY_OUT_DIR ?? "node_modules/.cache/scenity-editor-gallery";
/** The folder of the editor app: the web servers build and serve from it, also for the config of a plugin. */
const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The URL of the lab page server of the gallery. */
export const LAB_GALLERY_URL = `http://127.0.0.1:${String(port)}`;

/** The settings of each gallery config of the editor: the waits, the baseline paths and the screenshot rules. */
export const GALLERY_BASE = {
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/gallery",
  // Baselines per browser and platform. The committed baselines are Chromium on macOS (darwin).
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}-{platform}/{arg}{ext}",
  timeout: ciWaitMs(30_000),
  expect: {
    timeout: ciWaitMs(10_000),
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    baseURL: LAB_GALLERY_URL,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
} satisfies PlaywrightTestConfig;

/** The web server of the lab page: a build of the editor app (vite.config.ts) and the gallery server. */
export const LAB_GALLERY_SERVER = {
  command: `bunx --bun vite build --outDir ${outDir} --emptyOutDir && bun scripts/static/gallery-server.ts --root ${outDir} --port ${String(port)}`,
  cwd: APP_DIR,
  url: LAB_GALLERY_URL,
  reuseExistingServer: false,
  timeout: 180_000,
};

/** The web server of the scene page: a build of vite.scene.config.ts and the gallery server. */
const SCENE_GALLERY_SERVER = {
  command: `bunx --bun vite build --config vite.scene.config.ts --outDir ${sceneOutDir} --emptyOutDir && bun scripts/static/gallery-server.ts --root ${sceneOutDir} --index scene.html --port ${String(scenePort)}`,
  cwd: APP_DIR,
  url: `http://127.0.0.1:${String(scenePort)}`,
  reuseExistingServer: false,
  timeout: 180_000,
};

export default defineConfig({
  ...GALLERY_BASE,
  testDir: "tests/gallery",
  projects: [
    {
      // The samples from their documents, drawn by the scene builder (WebGL on the main thread).
      name: "scene",
      // characters.spec.ts is the animated robot of the characters sample. gltf-samples.spec.ts is the Khronos
      // samples with WebGL in the generic scene worker. audio.spec.ts is the chirp of the robot.
      // showroom-index.spec.ts fills the frame index of the showroom. crowd.spec.ts is 500 tables of the showroom:
      // its picture, and its frame time at the medium tier (run it alone with --workers=1).
      testMatch: [
        "showroom.spec.ts",
        "showroom-index.spec.ts",
        "characters.spec.ts",
        "gltf-samples.spec.ts",
        "audio.spec.ts",
        "crowd.spec.ts",
        // effects.spec.ts is the post-processing effects of the showroom and their tier caps.
        "effects.spec.ts",
        // inspect.spec.ts is the inspect panel and the debug layers of the scene page (no baselines).
        "inspect.spec.ts",
        // player.spec.ts is the plain player pages (player/*.html) against the baselines of the scene page.
        "player.spec.ts",
        // player-fallback.spec.ts forces renderer failures and slow frames on the player pages.
        "player-fallback.spec.ts",
        // plugins.spec.ts is the demo plugin of the spin sample on the scene page and in the player.
        "plugins.spec.ts",
        // input.spec.ts is the input of the play mode of the spin sample: a recording gives the same frames again.
        "input.spec.ts",
        // physics.spec.ts is the physics sample: its baselines, and a play, a seek back and a play again.
        "physics.spec.ts",
        // walkthrough.spec.ts is the walkthrough sample (characters, routes, a pickup, the animator, a tour camera).
        // sim-road.spec.ts is the road crossing sample with the traffic simulation and the play mode input.
        "walkthrough.spec.ts",
        "sim-road.spec.ts",
        // hub.spec.ts is the Hub of Scenity Studio with a fake host API: its states and the axe checks.
        "hub.spec.ts",
        // editor-themes.spec.ts is the editor window in the four theme variants and its axe checks.
        "editor-themes.spec.ts",
        // editor-sizes.spec.ts is the editor window at three sizes (the rails of a small window).
        "editor-sizes.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://127.0.0.1:${String(scenePort)}`,
      },
    },
    {
      // The Khronos samples with WebGPU on the main thread. On macOS the new headless mode (channel "chromium") has
      // the Metal adapter. On other platforms the set skips. The baselines are in __screenshots__/scene-webgpu-darwin.
      name: "scene-webgpu",
      // materials.spec.ts compares each material type on WebGL and WebGPU.
      // effects.spec.ts compares each post-processing effect on WebGL and WebGPU.
      // showroom-webgpu.spec.ts is the showroom with its built KTX2 textures.
      testMatch: ["gltf-samples.spec.ts", "materials.spec.ts", "effects.spec.ts", "showroom-webgpu.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://127.0.0.1:${String(scenePort)}`,
        ...(process.platform === "darwin" ? { channel: "chromium" } : {}),
      },
    },
  ],
  webServer: [SCENE_GALLERY_SERVER],
});
