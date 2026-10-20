// SPDX-License-Identifier: Apache-2.0
// The tutorials of the editor window: three tutorials (the first scene, a prefab, a sequence). The spec starts each
// tutorial on a copy of the showroom. It does each step as a person does it (the commands of the menus, the key mark of
// the inspector, a save). It sees the card move to the next step after each check, up to "done". The sequence tutorial
// makes a new sequence, which reloads the window: the tutorial continues at the same step. The files of the repository
// never change. Run it alone:
//   bunx --bun playwright test studio-tutorials --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 120_000 };

test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-tutorials-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  server = await startSpecServer({ tutorials: dir });
  origin = server.origin;
  key = server.keys.tutorials ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

/** Run a command of the page as a menu does. */
function command(page: Page, id: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return page.evaluate(([name, values]) => globalThis.__scenity?.command?.(name, values), [id, args] as const);
}

const step = (page: Page) => page.getByTestId("tutorial");

test("the first scene: add, name, light, place and save an entity", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // Help → Tutorials → Your first scene.
  await page.getByTestId("menu-help").click();
  await page.getByRole("menuitem", { name: "Tutorials" }).hover();
  await page.getByRole("menuitem", { name: "Your first scene" }).click();
  await expect(step(page)).toHaveAttribute("data-step", "add");
  await expect(page.getByTestId("ui-callout")).toBeVisible();
  await command(page, "entity.add", {});
  await expect(step(page)).toHaveAttribute("data-step", "name");
  const id = await page.evaluate(() => globalThis.__scenity?.selection?.()[0] ?? "");
  await command(page, "entity.rename", { entity: id, name: "Lamp" });
  await expect(step(page)).toHaveAttribute("data-step", "light");
  await command(page, "component.add", { entity: id, component: "light", value: '{"type":"point"}' });
  await expect(step(page)).toHaveAttribute("data-step", "place");
  // Show me puts the callout on the Position field again.
  await page.getByTestId("tutorial-show").click();
  await expect(page.getByTestId("ui-callout")).toBeVisible();
  await command(page, "component.set", { entity: id, component: "transform", field: "position", value: "[0, 2, 0]" });
  await expect(step(page)).toHaveAttribute("data-step", "save");
  await page.keyboard.press("ControlOrMeta+S");
  // The save checks the rules of the project first.
  await expect(step(page)).toHaveAttribute("data-step", "done", READY);
  await page.getByTestId("tutorial-end").click();
  await expect(step(page)).toHaveCount(0);
});

test("a prefab: select, make a prefab, copy the instance and save", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await command(page, "tutorial.start.prefab");
  await expect(step(page)).toHaveAttribute("data-step", "select");
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await expect(step(page)).toHaveAttribute("data-step", "make");
  await command(page, "prefab.create", { name: "chair" });
  await expect(step(page)).toHaveAttribute("data-step", "copy", READY);
  expect(existsSync(join(dir, "prefabs/chair.prefab.json"))).toBe(true);
  await command(page, "entity.duplicate", {});
  await expect(step(page)).toHaveAttribute("data-step", "save");
  await page.keyboard.press("ControlOrMeta+S");
  // The save checks the rules of the project first.
  await expect(step(page)).toHaveAttribute("data-step", "done", READY);
});

test("a sequence: a new sequence, two keys and play; the tutorial goes on after the reload", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await command(page, "tutorial.start.sequence");
  await expect(step(page)).toHaveAttribute("data-step", "new");
  // The new sequence reloads the window with the sequence in its address.
  await Promise.all([page.waitForURL(/sequence=/, READY), command(page, "sequence.new", { name: "intro" })]);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(step(page)).toHaveAttribute("data-step", "select");
  await page.evaluate(() => globalThis.__scenity?.select?.(["ottoman"]));
  await expect(step(page)).toHaveAttribute("data-step", "key");
  const mark = page.getByTestId("field-transform-position-row-key");
  await mark.click();
  await expect(step(page)).toHaveAttribute("data-step", "second");
  await command(page, "clock.seek", { ms: 2000 });
  await command(page, "component.set", {
    entity: "ottoman",
    component: "transform",
    field: "position",
    value: "[1, 0, 1]",
  });
  await mark.click();
  await expect(step(page)).toHaveAttribute("data-step", "play");
  await command(page, "clock.toggle");
  await expect(step(page)).toHaveAttribute("data-step", "done");
});
