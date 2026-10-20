// SPDX-License-Identifier: Apache-2.0
// Roles and review links. The studio runs the script driver: a turn of the agent moves the armchair. The owner shares
// the turn for review. A new browser (no session) opens the review link as a viewer, and the window says so in a
// banner. Save and the turn actions are disabled with the reason, and an edit is refused with the reason. The viewer
// adds a note in the Notes panel (the note file of the scene is the one write of a viewer).
//   bunx --bun playwright test studio-review --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 90_000 };
const VIEWER = "A viewer changes nothing: ask the owner of the studio for a link with the editor role.";
const SCRIPT = {
  turns: [
    [
      { tool: "scene_command", input: { command: "entity.move", args: { entity: "armchair", x: -1.2 } } },
      { say: "The armchair is closer to the lamp now." },
    ],
  ],
};

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let server: SpecServer | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-review-"));
  const room = join(dir, "showroom");
  mkdirSync(room);
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(room, part), { recursive: true });
  writeFileSync(join(dir, "script.json"), JSON.stringify(SCRIPT));
  server = await startSpecServer({ showroom: room }, { SCENITY_AGENT_SCRIPT: join(dir, "script.json") });
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("a viewer opens a review link of a turn, sees why the controls are off, and leaves a note", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium" || server === null, "the studio spec runs in Chromium");
  const origin = server?.origin ?? "";
  const key = server?.keys.showroom ?? "showroom";
  // The owner: a turn of the agent, then "Share for review".
  const owner = await browser.newContext();
  await server?.signIn(owner);
  const page = await owner.newPage();
  await page.goto(`${origin}/p/${key}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await page.getByTestId("agent-composer").fill("move the armchair near the lamp");
  await page.keyboard.press("ControlOrMeta+Enter");
  const share = page.getByTestId("agent-share-turn").first();
  await expect(share).toBeVisible(READY);
  await share.click();
  const field = page.getByTestId("agent-share-link");
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toMatch(/\/launch\?code=[0-9a-f]+&next=/);
  await page.keyboard.press("Escape");
  // The viewer: a new browser with no session opens the link.
  const viewer = await browser.newContext();
  const look = await viewer.newPage();
  await look.goto(link);
  await look.waitForSelector('canvas[data-ready="1"]', READY);
  await expect(look.locator('[data-banner="viewer"]')).toBeVisible(READY);
  // Save is disabled with the reason. An edit is refused with the reason.
  const save = look.locator(`#scene-bar button[data-command="file.save"]`);
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("title", VIEWER);
  const refused = await look.evaluate(() =>
    globalThis.__scenity?.apply([
      { op: "set" as const, path: "/entities/armchair/components/transform/position", value: [0, 0, 0] },
    ]),
  );
  expect(refused).toBe(VIEWER);
  // The session of the turn shows. Its actions and the composer are disabled with the reason.
  const turn = look.getByTestId("agent-share-turn").first();
  await expect(turn).toBeVisible(READY);
  await expect(turn).toBeDisabled();
  await expect(turn).toHaveAttribute("title", VIEWER);
  await expect(look.getByTestId("agent-composer")).toBeDisabled();
  // The viewer adds a note: the note file of the scene has it.
  await look.getByTestId("notes-new-text").fill("The armchair hides the lamp from the front camera.");
  await look.getByTestId("notes-add").click();
  const notes = join(dir, "showroom", "scenes", "main.notes.json");
  await expect
    .poll(() => (existsSync(notes) ? readFileSync(notes, "utf8") : ""), READY)
    .toContain("The armchair hides the lamp");
  await viewer.close();
  await owner.close();
});
