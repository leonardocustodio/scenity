// SPDX-License-Identifier: Apache-2.0
import { platform } from "node:os";
import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end tests of the workbench page: the page in Chromium on the host in test
 * mode (packages/workbench-host/tests/e2e-host), with the real lab of this checkout in its frame. The global setup
 * takes the GPU lock of the lab tools and starts the host and the page server. The pages draw WebGL, so the tests
 * run one at a time. Each run writes into its own output folder.
 *
 * Run: bun run e2e (in apps/workbench). `labs verify --visual` runs it too.
 */

// The workers load this file again; they take the folder of the main process from the environment.
process.env.CB_WORKBENCH_E2E_OUT ??= `test-results/e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outputDir = process.env.CB_WORKBENCH_E2E_OUT;

// The GPU of the machine (Metal on macOS); Linux uses the default (SwiftShader without a GPU), as the lab tools do.
const GPU_ARGS = platform() === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [];

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: GPU_ARGS },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
