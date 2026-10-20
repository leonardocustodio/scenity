// SPDX-License-Identifier: Apache-2.0
// The editor window at three sizes: a small window (the sides fold to the rails), the
// smallest full window (1280×720) and a large window. The scene view and the frame rate are masked (the GPU and the
// time give them). The showroom of the scene page build, in the edit mode.
import { expect, test } from "@playwright/test";

test.use({ locale: "en-US", timezoneId: "UTC" });
test.describe.configure({ timeout: 120_000 });

const SIZES = [
  { width: 1024, height: 700 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

for (const size of SIZES) {
  const name = `${String(size.width)}x${String(size.height)}`;
  test(`the editor window at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.removeItem("scenity.studio.layout"));
    await page.goto("/scene.html?project=showroom&camera=front&edit=1&scene=scenes/main.scene.json");
    const view = page.getByTestId("scene-view");
    await expect(view).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
    for (const mark of ["data-hierarchy", "data-inspector"]) await expect(view).toHaveAttribute(mark, "1");
    await expect(page.getByTestId("studio-rail-left")).toHaveCount(size.width < 1280 ? 1 : 0);
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await expect(page).toHaveScreenshot(`editor-size-${name}.png`, {
      mask: [page.getByTestId("studio-view"), page.getByTestId("status-render"), page.getByTestId("status-problems")],
    });
  });
}
