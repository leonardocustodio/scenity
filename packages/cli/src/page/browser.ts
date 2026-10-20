// SPDX-License-Identifier: Apache-2.0
/**
 * The headless Chromium of `scenity bench` and `scenity shot`.
 *
 * On macOS the browser is the new headless mode of Chromium (channel "chromium"), which has the Metal adapter, so
 * WebGPU draws there. Elsewhere the headless shell draws WebGL, on the CPU when the machine has no GPU (SwiftShader on
 * the CI runners). The gallery of the editor (apps/editor/playwright.gallery.config.ts) uses the same browsers.
 */
import { existsSync } from "node:fs";
import type { Browser } from "@playwright/test";

/** Start headless Chromium. Playwright is a dev dependency of the CLI: it loads only here, at run time. */
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("@playwright/test");
  return chromium.launch(process.platform === "darwin" ? { channel: "chromium" } : {});
}

/** True when Playwright and its Chromium are on this machine (`bunx playwright install chromium`). */
export async function browserPresent(): Promise<boolean> {
  try {
    const { chromium } = await import("@playwright/test");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
