// SPDX-License-Identifier: Apache-2.0
// Save to files on the scene page in the edit mode. A drag moves an entity of the showroom through the scene channel,
// and Save writes the canonical scene file. A reload shows the same frame (the same document, the same hash and the
// same pixels). `git diff` (the diff of the Changes tab) shows the JSON diff. A dirty document returns from the local
// draft after a reload. A save over a file that changed on the disk gives the Reload and Overwrite notice. A variant
// made from the edits gives the same frame as the edits. The spec starts the dev server of the scene page on a copy of
// the showroom in a temp folder, so the files of the repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-save --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";
import { sceneCanvasShot } from "../support/sceneCanvas";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SCENE = "scenes/main.scene.json";
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/** Run Git in the project copy and give its output. */
function git(...args: string[]): string {
  const run = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-save-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  // A Git checkout, as for the Changes tab of the workbench.
  git("init", "--quiet", "--initial-branch=main");
  git("-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "scenes", "scenity.project.json");
  git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--quiet", "-m", "showroom");
  server = await startSpecServer({ save: dir });
  origin = server.origin;
  key = server.keys.save ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy of the showroom in the edit mode and wait for the first frame with every asset. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

/** A canvas point (CSS pixels) on an entity: the first point of a grid where the pick finds it. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async (entity) => {
    const canvas = document.querySelector("canvas");
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    // The canvas is in the Scene view panel, not at the corner of the page.
    const rect = canvas?.getBoundingClientRect();
    // The inspector panel covers a part of the canvas. A point under it does not reach the canvas.
    for (let y = height * 0.3; y < height * 0.95; y += 12) {
      for (let x = width * 0.05; x < width * 0.95; x += 12) {
        if (document.elementFromPoint((rect?.left ?? 0) + x, (rect?.top ?? 0) + y) !== canvas) continue;
        if ((await globalThis.__scenity?.pick(x, y))?.entity === entity) return { x, y };
      }
    }
    return null;
  }, id);
  if (found === null) throw new Error(`no point of the canvas shows ${id}`);
  const box = await page.getByTestId("scene-view").boundingBox();
  return { x: (box?.x ?? 0) + found.x, y: (box?.y ?? 0) + found.y };
}

/** The position of the transform of an entity in the document of the page. */
function position(page: Page, id: string): Promise<readonly number[] | undefined> {
  return page.evaluate((entity) => {
    const transform = globalThis.__scenity?.document().entities[entity]?.components.transform as
      { position?: number[] } | undefined;
    return transform?.position;
  }, id);
}

/** Drag an entity by `dx` CSS pixels to the right and wait for the end of the drag. */
async function drag(page: Page, id: string, dx: number): Promise<void> {
  const start = await pointOn(page, id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-drag", id);
  await page.mouse.move(start.x + dx, start.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("scene-view")).not.toHaveAttribute("data-drag", id);
  await page.evaluate(() => globalThis.__scenity?.frame());
}

test("move, save, reload: the same frame, and the diff shows the JSON change", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const before = await position(page, "table");
  expect(before).toEqual([1.6, 0, -0.9]);
  await drag(page, "table", 120);
  const moved = await position(page, "table");
  expect(moved?.[0]).toBeGreaterThan(1.7);
  expect(moved?.[1]).toBe(0);
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  // One drag is one step of the history.
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect(await position(page, "table")).toEqual(before);
  expect(await page.evaluate(() => globalThis.__scenity?.redo())).toBe(true);
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const saved = await page.evaluate(() => globalThis.__scenity?.file());
  const disk = readFileSync(join(dir, SCENE), "utf8");
  expect(disk).toContain(`"position": [${(moved ?? []).join(", ")}]`);
  // The compare covers the scene canvas only: the panels and the dock of the edit mode are not in the picture.
  const after = await sceneCanvasShot(page);
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  expect(await position(page, "table")).toEqual(moved);
  const reloaded = await page.evaluate(() => globalThis.__scenity?.file());
  expect(reloaded).toEqual({ path: SCENE, baseHash: saved?.baseHash, dirty: false });
  const again = await sceneCanvasShot(page);
  const diff = await diffFrames(context, after, again);
  expect(diff.differ).toBeLessThan(200);
  // The diff of the Changes tab (`git.diff` of the host runs `git diff`): one changed line of JSON.
  const patch = git("diff", "--", SCENE);
  const lines = patch.split("\n").filter((line) => /^[-+] /.test(line));
  expect(lines.map((line) => line.replace(/\s+/g, " "))).toEqual([
    '- "position": [1.6, 0, -0.9]',
    `+ "position": [${(moved ?? []).join(", ")}]`,
  ]);
});

test("a dirty document comes back from the local draft; a save over a changed file gives a dialog with the diff", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const start = await position(page, "ottoman");
  await drag(page, "ottoman", -80);
  const moved = await position(page, "ottoman");
  expect(moved).not.toEqual(start);
  // The page reloads with no save: the next load offers the draft.
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  expect(await position(page, "ottoman")).toEqual(start);
  await page.getByTestId("draft-restore").click();
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  expect(await position(page, "ottoman")).toEqual(moved);
  // Another tool writes the file: the save gives the notice and keeps the file of the other tool.
  const theirs = readFileSync(join(dir, SCENE), "utf8").replace('"name": "Ottoman"', '"name": "Footstool"');
  writeFileSync(join(dir, SCENE), theirs);
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-notice")).toHaveAttribute("data-kind", "conflict");
  expect(readFileSync(join(dir, SCENE), "utf8")).toBe(theirs);
  // The dialog shows the semantic diff view from the scene of the editor to the file of the other tool.
  await page.getByTestId("dialog-details").locator("summary").click();
  const ottoman = page.getByTestId("semantic-diff").locator('[data-entity="ottoman"]');
  await expect(ottoman.locator('[data-field="name"]')).toContainText("Footstool");
  await expect(ottoman.locator('[data-component="transform"]')).toHaveCount(1);
  await page.getByTestId("conflict-overwrite").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  expect(readFileSync(join(dir, SCENE), "utf8")).toContain(`"position": [${(moved ?? []).join(", ")}]`);
});

test("a variant made from the edits gives the same frame as the edits", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const start = (await position(page, "table")) ?? [];
  const base = await sceneCanvasShot(page);
  const moved = [(start[0] ?? 0) - 0.8, start[1] ?? 0, start[2] ?? 0];
  const path = "/entities/table/components/transform/position";
  expect(
    await page.evaluate((ops) => globalThis.__scenity?.apply(ops), [{ op: "set" as const, path, value: moved }]),
  ).toBeNull();
  await page.evaluate(() => globalThis.__scenity?.frame());
  const edits = await sceneCanvasShot(page);
  expect((await diffFrames(context, base, edits)).differ).toBeGreaterThan(200);
  // Make the variant: its layer file goes beside the scene, and the scene returns to the saved place.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.variants"));
  const panel = page.getByTestId("variants-panel");
  await panel.getByTestId("variants-new-name").fill("Evening");
  await panel.getByTestId("variants-make").click();
  await expect.poll(() => existsSync(join(dir, "scenes/main.evening.overrides.json"))).toBe(true);
  await expect.poll(() => position(page, "table")).toEqual(start);
  // Show the variant: the frame of the edits, with the base scene as the document.
  await panel.locator('[data-testid="variants-row"][data-variant="evening"]').getByTestId("variants-show").click();
  await expect(panel).toHaveAttribute("data-shown", "evening");
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect((await diffFrames(context, edits, await sceneCanvasShot(page))).differ).toBeLessThan(200);
  expect(await position(page, "table")).toEqual(start);
  // Base shows the scene again; the compare gives the wipe of two pictures.
  await panel.locator('[data-testid="variants-row"][data-variant=""]').getByTestId("variants-show").click();
  await expect(panel).toHaveAttribute("data-shown", "");
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect((await diffFrames(context, base, await sceneCanvasShot(page))).differ).toBeLessThan(200);
  await panel.getByTestId("variants-compare").click();
  await expect(panel.getByTestId("variants-wipe")).toBeVisible();
});
