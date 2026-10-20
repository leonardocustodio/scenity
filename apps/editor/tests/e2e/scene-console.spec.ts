// SPDX-License-Identifier: Apache-2.0
// The Console panel. An error of the dev scene worker shows once with its count and its source. The counters filter
// the levels, and a search keeps the lines with its words. A click on a line shows it in the detail pane and selects
// the entity that it names. The copy of the showroom lists the test plugin of tests/fixtures/console-plugin. Its
// presenter writes the same error in the worker at each create and update.
//   bunx --bun playwright test scene-console --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const PLUGIN = join(LABS_ROOT, "tests/fixtures/console-plugin");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-console-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  const projectFile = join(dir, "scenity.project.json");
  const project = JSON.parse(readFileSync(projectFile, "utf8")) as Record<string, unknown>;
  writeFileSync(projectFile, `${JSON.stringify({ ...project, plugins: [PLUGIN] }, null, 2)}\n`);
  server = await startSpecServer({ console: dir });
  origin = server.origin;
  key = server.keys.console ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-renderer", "worker", READY);
}

test("a worker error shows once with its count and its source", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(async () => {
    const scenity = globalThis.__scenity;
    await scenity?.command?.("component.add", { entity: "armchair", component: "noisy.alarm" });
    for (const level of [2, 3, 4]) {
      await scenity?.command?.("component.set", {
        entity: "armchair",
        component: "noisy.alarm",
        field: "level",
        value: JSON.stringify(level),
      });
    }
    await scenity?.frame();
  });
  await page.keyboard.press("ControlOrMeta+Shift+C");
  const panel = page.getByTestId("console-panel");
  const line = panel.locator('[data-testid="console-line"][data-source="worker"]', { hasText: "noisy.alarm" });
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-level", "error");
  await expect
    .poll(async () => Number(await line.getByTestId("console-count").textContent()))
    .toBeGreaterThanOrEqual(4);
  // A click shows the line in the detail pane and selects the entity that it names.
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  await line.click();
  await expect(panel.getByTestId("console-detail")).toContainText("Worker");
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.() ?? [])).toEqual(["armchair"]);
  // The counter of the errors hides them; the search keeps the lines with its words.
  await panel.locator('[data-testid="console-counter"][data-level="error"]').click();
  await expect(line).toHaveCount(0);
  await panel.locator('[data-testid="console-counter"][data-level="error"]').click();
  await panel.getByTestId("console-search").fill("no such words");
  await expect(line).toHaveCount(0);
  await panel.getByTestId("console-search").fill("alarm rings");
  await expect(line).toHaveCount(1);
});
