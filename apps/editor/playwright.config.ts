// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { ciWaitMs, ciWorkerOption } from "./tests/support/ci-timing";

/**
 * The end-to-end tests of the editor app: the scene page and the pane loop of the renderer in three browsers. The
 * editor face of a plugin runs the specs of its lab page with its own config. That config imports `E2E_BASE` and
 * `LAB_BUILD_SETUP` of this file.
 */
const FIREFOX_PREFS = { "browser.tabs.remote.useCrossOriginOpenerPolicy": false } as const;

// The dev servers of the specs keep no drafts on the host, so the unsaved edits of one test never return in the next
// one. The recovery spec enables the drafts for its own server. The servers of the specs read this variable.
process.env.SCENITY_SCENE_HOST_DRAFTS ??= "0";

/**
 * The global setup that builds the lab page of the editor once (tests/e2e/global-setup.ts). A spec serves the build
 * with the static server scripts/static/serve-static.ts.
 */
export const LAB_BUILD_SETUP = fileURLToPath(new URL("./tests/e2e/global-setup.ts", import.meta.url));

/** The settings of each end-to-end config of the editor: the waits, the workers, the reporter and the browsers. */
export const E2E_BASE = {
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  // A CI runner with few CPUs and no GPU gets longer waits (tests/support/ci-timing.ts).
  timeout: ciWaitMs(45_000),
  expect: { timeout: ciWaitMs(5_000) },
  // A CI runner draws WebGL on its CPUs (no GPU): parallel pages starve each other. The workflow sets the count of
  // workers (SCENITY_CI_PLAYWRIGHT_WORKERS); without it Playwright uses half of the CPUs.
  ...ciWorkerOption(),
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: FIREFOX_PREFS } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, retries: process.env.CI === "true" ? 1 : 0 },
  ],
} satisfies PlaywrightTestConfig;

export default defineConfig({
  ...E2E_BASE,
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
});
