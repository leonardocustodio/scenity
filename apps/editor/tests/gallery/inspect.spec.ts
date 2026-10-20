// SPDX-License-Identifier: Apache-2.0
// The dev tools of the scene page: the inspect report of the showroom, its panel
// and the debug layers (`debug=` in the URL, the boxes of the panel, `__scenity.debug`). The frames have no baselines:
// the test compares the canvas with and without the layers, and reads the report.
import { expect, test } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

test("the showroom with debug=bounds and the inspect panel", async ({ page }) => {
  await page.goto("/scene.html?project=showroom&camera=front&debug=bounds&inspect=1");
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  const panel = page.getByTestId("scene-inspect");
  await expect(panel).toBeVisible();
  await expect(panel.locator('tr[data-entity="table"]')).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "bounds" })).toBeChecked();

  const report = await page.evaluate(() => globalThis.__scenity?.inspect?.());
  expect(report?.layers.on).toEqual(["bounds"]);
  expect(report?.layers.names).toEqual(expect.arrayContaining(["bounds", "skeleton", "wireframe", "cameras"]));
  expect(report?.entities.map((entity) => entity.id)).toContain("armchair");
  const table = report?.entities.find((entity) => entity.id === "table");
  expect(table?.components).toEqual(["model", "obstacle", "socket", "transform"]);
  expect(table?.bounds).not.toBeNull();
  expect(Object.keys(table?.sockets ?? {})).toEqual(["top"]);
  expect(table?.stats.triangles).toBeGreaterThan(0);
  expect(report?.totals.triangles).toBeGreaterThan(1000);

  // The bounds layer draws lines over the frame: the canvas differs from the frame with no layer.
  const shot = () => view.screenshot({ animations: "disabled" });
  const withBounds = await shot();
  await page.evaluate(() => globalThis.__scenity?.debug?.([]));
  expect(await page.evaluate(() => location.search)).not.toContain("debug=");
  const plain = await shot();
  expect(withBounds.equals(plain)).toBe(false);

  // A box of the panel enables a layer, and the URL follows.
  await panel.getByRole("checkbox", { name: "sockets" }).check();
  await expect.poll(() => page.evaluate(() => location.search)).toContain("debug=sockets");
  await expect
    .poll(async () => (await page.evaluate(() => globalThis.__scenity?.inspect?.()))?.layers.on)
    .toEqual(["sockets"]);

  // A click on a row shows the report of the entity.
  await panel.locator('tr[data-entity="table"]').click();
  await expect(page.getByTestId("scene-inspect-detail")).toContainText('"id": "table"');
});

test("the robot of the characters sample has the joints of its skeleton", async ({ page }) => {
  await page.goto("/scene.html?project=characters&camera=front&t=500&paused=1&debug=skeleton");
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  // The panel is closed until the I key.
  await expect(page.getByTestId("scene-inspect")).toBeHidden();
  const report = await page.evaluate(() => globalThis.__scenity?.inspect?.());
  expect(report?.layers.on).toEqual(["skeleton"]);
  const robot = report?.entities.find((entity) => entity.id === "robot");
  expect(Object.keys(robot?.joints ?? {}).length).toBeGreaterThan(20);
  await page.keyboard.press("i");
  await expect(page.getByTestId("scene-inspect")).toBeVisible();
});
