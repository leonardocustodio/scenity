// SPDX-License-Identifier: Apache-2.0
// The Search window. ⌘⇧K opens it, and `c:light intensity>2` lists the lights brighter than 2 with an editable
// intensity column. An edit of a cell is one undo step, and a saved search stays after a reload. ⌥↩ in the search box
// opens its text in the window. The spec runs on a copy of the showroom.
//   bunx --bun playwright test scene-search --project=chromium --workers=1
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-search-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ search: dir });
  origin = server.origin;
  key = server.keys.search ?? "";
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
}

const intensity = (page: Page, id: string) =>
  page.evaluate(
    (entity) =>
      (globalThis.__scenity?.document().entities[entity]?.components.light as { intensity?: number } | undefined)
        ?.intensity,
    id,
  );

test("c:light intensity>2 lists the lights with an editable intensity column; a saved search stays", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByTestId("scene-view").click();
  await page.keyboard.press("ControlOrMeta+Shift+k");
  const window = page.getByTestId("search-window");
  await expect(window).toBeVisible();
  await window.getByTestId("search-window-input").fill("c:light intensity>2");
  const rows = window.getByTestId("search-table-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-entity", "sun");
  await expect(window.getByTestId("search-column")).toHaveText(["intensity"]);
  // A lower bound lists the lantern too; the cell of the sun edits its light as one undo step.
  await window.getByTestId("search-window-input").fill("c:light intensity>1");
  await expect(rows).toHaveCount(2);
  const cell = window.locator('[data-testid="search-table-row"][data-entity="sun"] [data-testid="search-cell"]');
  await expect(cell).toHaveValue("2.2");
  await cell.fill("3.5");
  await cell.press("Enter");
  await cell.blur();
  await expect.poll(() => intensity(page, "sun")).toBe(3.5);
  await page.evaluate(() => globalThis.__scenity?.command?.("history.undo"));
  await expect.poll(() => intensity(page, "sun")).toBe(2.2);
  await expect(cell).toHaveValue("2.2");
  // Select all selects the rows.
  await window.getByTestId("search-select-all").click();
  await expect
    .poll(() => page.evaluate(() => [...(globalThis.__scenity?.selection?.() ?? [])].sort()))
    .toEqual(["lantern-light", "sun"]);
  // Save, then a reload: the saved search runs again with one press.
  await window.getByTestId("search-window-input").fill("c:light intensity>2");
  await window.getByTestId("search-window-save").click();
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.getByTestId("scene-view").click();
  await page.keyboard.press("ControlOrMeta+Shift+k");
  await window.getByTestId("search-window-input").fill("");
  await window.getByTestId("search-saved").click();
  await expect(rows).toHaveCount(1);
  // ⌥↩ in the search box opens its text in the window.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("search-input").fill("t:camera");
  await page.keyboard.press("Alt+Enter");
  await expect(page.getByTestId("search")).toBeHidden();
  await expect(window.getByTestId("search-window-input")).toHaveValue("t:camera");
  await expect(rows.first()).toBeVisible();
});
