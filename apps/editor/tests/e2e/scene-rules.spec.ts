// SPDX-License-Identifier: Apache-2.0
// The rule gate of a save on the scene page in the edit mode. A move of the lantern off the table of the showroom
// breaks the block rule `showroom.lanternOnTable` of the scene. Save shows the
// refusal with the rule and the reason field, and the file stays. "Save with the reason" writes the file, and the log
// next to the scene keeps the reason. The spec starts the dev server of the scene page on a copy of the showroom in a
// temp folder, so the files of the repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-rules --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SCENE = "scenes/main.scene.json";
const LOG = "scenes/main.rules-log.jsonl";
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-rules-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ rules: dir });
  origin = server.origin;
  key = server.keys.rules ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** The position of the transform of an entity in the document of the page. */
function position(page: Page, id: string): Promise<readonly number[] | undefined> {
  return page.evaluate((entity) => {
    const transform = globalThis.__scenity?.document().entities[entity]?.components.transform as
      { position?: number[] } | undefined;
    return transform?.position;
  }, id);
}

test("a move that breaks a block rule: the refusal, the reason field, then a save with the reason", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const before = readFileSync(join(dir, SCENE), "utf8");
  const start = await position(page, "lantern");
  // Move the lantern off the table, to the middle of the room: one step of the history, as a drag or a gizmo gives.
  // (From the front camera the table covers the small lantern, so a drag cannot pick it.)
  const path = "/entities/lantern/components/transform/position";
  expect(
    await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [-1.6, 0.05, 1.2] }]), path),
  ).toBeNull();
  const moved = await position(page, "lantern");
  expect(moved).not.toEqual(start);
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  // The save stops: the notice names the rule and asks for a reason; the file stays.
  await page.getByTestId("scene-save").click();
  const notice = page.getByTestId("scene-notice");
  await expect(notice).toHaveAttribute("data-kind", "rules");
  await expect(page.getByTestId("scene-notice-text")).toContainText("showroom.lanternOnTable");
  await expect(page.getByTestId("scene-state")).toHaveText("not saved: a rule fails");
  await expect(page.getByTestId("rules-save")).toBeDisabled();
  expect(readFileSync(join(dir, SCENE), "utf8")).toBe(before);
  expect(existsSync(join(dir, LOG))).toBe(false);
  // The script API gives the same refusal.
  const again = await page.evaluate(() => globalThis.__scenity?.save());
  expect(again).toMatchObject({
    ok: false,
    conflict: false,
    blocked: [{ id: "showroom.lanternOnTable", status: "fail" }],
  });
  // A reason of the owner allows the save.
  await page.getByTestId("rules-reason").fill("the lantern moves to the shelf in the next change");
  // Enter in the field saves, as the button does (the bar of the gizmos can cover the button of the notice).
  await page.getByTestId("rules-reason").press("Enter");
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  await expect(notice).toBeHidden();
  expect(readFileSync(join(dir, SCENE), "utf8")).toContain(`"position": [${(moved ?? []).join(", ")}]`);
  const log = readFileSync(join(dir, LOG), "utf8").trim().split("\n");
  expect(log).toHaveLength(1);
  expect(JSON.parse(log[0] ?? "{}")).toMatchObject({
    scene: SCENE,
    reason: "the lantern moves to the shelf in the next change",
    rules: [{ id: "showroom.lanternOnTable", status: "fail" }],
  });
});
