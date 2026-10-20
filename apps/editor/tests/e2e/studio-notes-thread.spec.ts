// SPDX-License-Identifier: Apache-2.0
// Note threads for a team: two people reply in one thread. Two browser contexts are two people, each with a name in
// the user settings (`notes.author`). Ana pins a note on the armchair and replies in its thread. Bruno opens the same
// scene, sees the note and the reply, and replies too. Ana sees the reply of Bruno, and the note file holds both
// replies with their authors. The spec runs on a copy of the showroom, so the files of the repository never change.
// Run it alone:
//   bunx --bun playwright test studio-notes-thread --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 120_000 };

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-notes-thread-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  server = await startSpecServer({ team: dir });
  origin = server.origin;
  key = server.keys.team ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** The editor window of one person: a browser context with the name of the person in the user settings. */
async function person(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await server?.signIn(context);
  await context.addInitScript((author) => {
    localStorage.setItem("scenity.editor.user", JSON.stringify({ format: "scenity.editor/1", notes: { author } }));
  }, name);
  const page = await context.newPage();
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.notes"));
  await expect(page.getByTestId("notes-panel")).toBeVisible();
  return page;
}

/** Open the thread of the first note and send a reply. */
async function reply(page: Page, text: string): Promise<void> {
  const row = page.getByTestId("notes-row").first();
  if ((await row.getByTestId("notes-replies").count()) === 0) await row.getByTestId("notes-thread").click();
  await row.getByTestId("notes-reply-text").fill(text);
  await row.getByTestId("notes-reply-send").click();
}

test("two people reply in one thread of a note", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const ana = await person(browser, "Ana");
  await ana.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await ana.getByTestId("notes-new-text").fill("The armchair is too far from the table");
  await ana.getByTestId("notes-add").click();
  await expect(ana.getByTestId("notes-row")).toHaveCount(1);
  await reply(ana, "I can move it");
  await expect(ana.getByTestId("notes-reply")).toHaveCount(1);
  await expect(ana.getByTestId("notes-reply").first()).toContainText("Ana");

  const bruno = await person(browser, "Bruno");
  await expect(bruno.getByTestId("notes-row")).toHaveCount(1);
  await bruno.getByTestId("notes-thread").click();
  await expect(bruno.getByTestId("notes-reply")).toHaveCount(1);
  await reply(bruno, "Please move it 1 m to the left");
  await expect(bruno.getByTestId("notes-reply")).toHaveCount(2);

  // The panel of Ana reads the note file again: the reply of Bruno arrives.
  await expect(ana.getByTestId("notes-reply")).toHaveCount(2, { timeout: 15_000 });
  await expect(ana.getByTestId("notes-reply").nth(1)).toContainText("Bruno");
  const file = JSON.parse(readFileSync(join(dir, "scenes/main.notes.json"), "utf8")) as {
    notes: { at: string; author?: string; replies?: { author?: string; text: string }[] }[];
  };
  expect(file.notes[0]?.at).toBe("entity:armchair");
  expect(file.notes[0]?.author).toBe("Ana");
  expect(file.notes[0]?.replies?.map((each) => [each.author, each.text])).toEqual([
    ["Ana", "I can move it"],
    ["Bruno", "Please move it 1 m to the left"],
  ]);
});
