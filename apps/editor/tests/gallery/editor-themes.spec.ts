// SPDX-License-Identifier: Apache-2.0
// The editor window in the four theme variants: dark, light, navy and dark with more contrast.
// A baseline of each with the scene view and the frame rate masked (the GPU and the time give them), and the axe
// checks of the window. The showroom of the scene page build, in the edit mode.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "en-US", timezoneId: "UTC", viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const VARIANTS = [
  { theme: "dark", contrast: "standard" },
  { theme: "light", contrast: "standard" },
  { theme: "navy", contrast: "standard" },
  { theme: "dark", contrast: "more" },
] as const;

async function openEditor(page: Page, variant: (typeof VARIANTS)[number]): Promise<void> {
  await page.addInitScript((choice) => {
    localStorage.setItem("scenity.studio.theme", JSON.stringify(choice));
    localStorage.removeItem("scenity.studio.layout");
  }, variant);
  await page.goto("/scene.html?project=showroom&camera=front&edit=1&scene=scenes/main.scene.json");
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
  for (const mark of ["data-hierarchy", "data-inspector"]) await expect(view).toHaveAttribute(mark, "1");
  await expect(page.locator("body")).toHaveAttribute("data-theme", variant.theme);
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
}

for (const variant of VARIANTS) {
  const name = `${variant.theme}-${variant.contrast}`;
  test(`the editor window: ${name}`, async ({ page }) => {
    await openEditor(page, variant);
    await expect(page).toHaveScreenshot(`editor-${name}.png`, {
      mask: [page.getByTestId("studio-view"), page.getByTestId("status-render"), page.getByTestId("status-problems")],
    });
  });

  test(`axe: the editor window has no violations in ${name}`, async ({ page }) => {
    await openEditor(page, variant);
    const result = await new AxeBuilder({ page })
      .include("[data-testid=studio-shell]")
      .exclude("[data-testid=studio-view]")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}
