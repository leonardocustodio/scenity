// SPDX-License-Identifier: Apache-2.0
// The Simulation panel. The traffic sample (samples/sim-road) shows the states of its cars at the time of the clock,
// from the frame that the core draws. Another time gives other states. The page saves nothing, so the spec opens the
// sample of the checkout. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-simulation --project=chromium --workers=1
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let origin = "";
let server: SpecServer | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  server = await startSpecServer({ "sim-road": join(LABS_ROOT, "../../samples/sim-road") });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
});

async function open(page: Page, t: number): Promise<void> {
  await page.goto(
    `${origin}/scene.html?project=sim-road&scene=scenes/road.scene.json&camera=front&edit=1&sequence=sequences/rush.sequence.json&t=${String(t)}&paused=1`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

/** The cells of the rows of the cars table, by car. */
function cars(page: Page) {
  return page
    .locator('[data-plugin="traffic"] table[data-table="cars"] [data-testid="simulation-row"]')
    .evaluateAll((rows) => rows.map((row) => row.textContent));
}

test("the traffic sample shows its car states at a time", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 12_000);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.simulation"));
  const panel = page.getByTestId("simulation-panel");
  await expect(panel).toHaveAttribute("data-time", "12000", READY);
  await expect(panel.locator('[data-plugin="traffic"]')).toHaveCount(1);
  await expect.poll(async () => (await cars(page)).length, READY).toBeGreaterThan(0);
  const queue = await cars(page);
  // Another time of the clock gives other car states.
  await page.evaluate(() => globalThis.__scenity?.seek?.(3000));
  await expect(panel).toHaveAttribute("data-time", "3000");
  await expect.poll(() => cars(page)).not.toEqual(queue);
  await expect(panel.getByTestId("simulation-streams")).toBeVisible();
});
