// SPDX-License-Identifier: Apache-2.0
// The selection tools: Select all and none, Back and Forward in the selection history, Select
// by tag from the Edit menu, Invert and Select children, and a copy in one project that pastes into another project
// (two copies of the showroom on one dev server: one origin, one clipboard).
//   bunx --bun playwright test scene-selection --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** The key of a project of the spec in the page URLs. */
const key = (name: string): string => server?.keys[name] ?? name;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-selection-"));
  for (const copy of ["one", "two"]) {
    for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
      cpSync(join(SHOWROOM, part), join(dir, copy, part), { recursive: true });
    }
  }
  server = await startSpecServer({ one: join(dir, "one"), two: join(dir, "two") });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page, project: string): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key(project)}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

const selection = (page: Page) => page.evaluate(() => [...(globalThis.__scenity?.selection?.() ?? [])].sort());
const select = (page: Page, ids: string[]) => page.evaluate((list) => globalThis.__scenity?.select?.(list), ids);

test("the selection tools work by key and from the Edit menu; a copy pastes into another project", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "one");
  const all = await page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).sort());
  await page.keyboard.press("ControlOrMeta+A");
  await expect.poll(() => selection(page)).toEqual(all);
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect.poll(() => selection(page)).toEqual([]);
  // Back and Forward go through the selection history.
  await select(page, ["lantern"]);
  await select(page, ["armchair"]);
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await expect.poll(() => selection(page)).toEqual(["lantern"]);
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await expect.poll(() => selection(page)).toEqual(["armchair"]);
  // Edit ▸ Select by ▸ Select by tag asks for the tag.
  await page.getByTestId("menu-edit").click();
  await page.getByRole("menuitem", { name: "Select by", exact: true }).click();
  await page.getByRole("menuitem", { name: /Select by tag/ }).click();
  await page.getByTestId("command-prompt-input").fill("furniture");
  await page.getByTestId("command-prompt-go").click();
  const furniture = await page.evaluate(() =>
    Object.entries(globalThis.__scenity?.document().entities ?? {})
      .filter(([, entity]) => (entity.tags ?? []).includes("furniture"))
      .map(([id]) => id)
      .sort(),
  );
  await expect.poll(() => selection(page)).toEqual(furniture);
  // Invert and Select children are commands too.
  await page.evaluate(() => globalThis.__scenity?.command?.("selection.invert", {}));
  await expect.poll(() => selection(page)).toEqual(all.filter((id) => !furniture.includes(id)));
  // A copy in project one pastes into project two (the copy has the children of the lantern).
  const copied = await page.evaluate(() => {
    const entities = globalThis.__scenity?.document().entities ?? {};
    const under = (id: string): number =>
      1 +
      Object.keys(entities)
        .filter((child) => entities[child]?.parent === id)
        .reduce((sum, child) => sum + under(child), 0);
    return under("lantern");
  });
  await select(page, ["lantern"]);
  await page.keyboard.press("ControlOrMeta+C");
  await open(page, "two");
  const before = await page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).length);
  await page.keyboard.press("ControlOrMeta+V");
  await expect
    .poll(() => page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).length))
    .toBe(before + copied);
});

test("the Tags panel renames a tag on each entity in one undo step", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "one");
  const tagged = (tag: string) =>
    page.evaluate(
      (name) =>
        Object.entries(globalThis.__scenity?.document().entities ?? {})
          .filter(([, entity]) => (entity.tags ?? []).includes(name))
          .map(([id]) => id)
          .sort(),
      tag,
    );
  const furniture = await tagged("furniture");
  expect(furniture.length).toBeGreaterThan(1);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.tags"));
  const row = page.locator('[data-testid="tags-row"][data-kind="tag"][data-name="furniture"]');
  await expect(row.getByTestId("tags-count")).toHaveText(String(furniture.length));
  // A press on the name selects its entities.
  await row.getByTestId("tags-select").click();
  await expect.poll(() => selection(page)).toEqual(furniture);
  await row.getByTestId("tags-rename").click();
  await page.getByTestId("tags-rename-input").fill("furnishing");
  await page.getByTestId("tags-rename-input").press("Enter");
  await expect.poll(() => tagged("furnishing")).toEqual(furniture);
  expect(await tagged("furniture")).toEqual([]);
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(() => tagged("furniture")).toEqual(furniture);
  expect(await tagged("furnishing")).toEqual([]);
});

test("notes show in the Scene view and in the hierarchy; the note file keeps them", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "two");
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.notes"));
  const panel = page.getByTestId("notes-panel");
  await expect(panel).toBeVisible();
  // A note on the table: the note file of the scene, a pin in the view and a mark on the row of the table.
  await select(page, ["table"]);
  await panel.getByTestId("notes-new-text").fill("The table needs a cloth");
  await panel.getByTestId("notes-add").click();
  await expect.poll(() => existsSync(join(dir, "two", "scenes/main.notes.json"))).toBe(true);
  const file = JSON.parse(readFileSync(join(dir, "two", "scenes/main.notes.json"), "utf8")) as {
    format: string;
    notes: { at: unknown; text: string }[];
  };
  expect(file).toMatchObject({
    format: "scenity.notes/1",
    notes: [{ at: "entity:table", text: "The table needs a cloth" }],
  });
  const pin = page.locator('[data-testid="scene-note-pin"][data-note="file:note-1"]');
  await expect(pin).toBeVisible();
  // The hierarchy shares the left side with the Notes panel.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.hierarchy"));
  await expect(page.getByTestId("hierarchy-notes-table")).toHaveText("1");
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.notes"));
  // The filter: no pins, then the open notes; Done closes the note.
  await panel.getByRole("combobox").click();
  await page.getByRole("option", { name: "No pins" }).click();
  await expect(pin).toHaveCount(0);
  await panel.getByRole("combobox").click();
  await page.getByRole("option", { name: "All notes" }).click();
  await expect(pin).toBeVisible();
  await panel.locator('[data-testid="notes-row"][data-note="file:note-1"]').getByTestId("notes-toggle").click();
  await expect(pin).toHaveAttribute("data-status", "done");
  // A press on the pin selects the entity of the note; a reload reads the note file again.
  await select(page, []);
  await pin.click();
  await expect.poll(() => selection(page)).toEqual(["table"]);
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.hierarchy"));
  await expect(page.getByTestId("hierarchy-notes-table")).toHaveText("1");
});
