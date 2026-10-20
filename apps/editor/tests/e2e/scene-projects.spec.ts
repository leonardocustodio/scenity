// SPDX-License-Identifier: Apache-2.0
// The scenes of a project on the scene page: two scenes of one project open one after the other, each with its own
// undo history. The spec copies the showroom to a temp folder. The start screen lists the project and its scenes. Main
// opens, and the table and the shelf move (two steps). New scene writes and opens a second scene, and a crate goes in
// and moves. The switch to main again shows its edits, and an undo cancels only the shelf of main. The second scene
// keeps its crate. Save as writes main to a new path (the first file stays). A reload shows both scenes in the start
// screen, and each one opens with its saved edits. The files of the repository never change. Run it alone under the
// GPU lock:
//   bunx --bun playwright test scene-projects --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const MAIN = "scenes/main.scene.json";
const SECOND = "scenes/second-room.scene.json";
const COPY = "scenes/main-copy.scene.json";
const READY = { timeout: 60_000 };

// The panels of the edit mode cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-projects-"));
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ projects: dir });
  origin = server.origin;
  key = server.keys.projects ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the start screen of the project and wait for its list. */
async function startScreen(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1`);
  await expect(page.getByTestId("scene-start")).toHaveAttribute("data-ready", "1", READY);
}

/**
 * Open a scene of the copy in the edit mode and wait for the frame and the hierarchy panel. A new scene has no
 * document camera: `camera` null takes the first one (or the default view).
 */
async function open(page: Page, scene: string, camera: string | null = "front"): Promise<void> {
  const view = camera === null ? "" : `&camera=${camera}`;
  await page.goto(`${origin}/scene.html?project=${key}&scene=${scene}${view}&edit=1`);
  const canvas = page.getByTestId("scene-view");
  await expect(canvas).toHaveAttribute("data-ready", "1", READY);
  await expect(canvas).toHaveAttribute("data-hierarchy", "1", READY);
}

/** The x of the position of an entity of the open document (null: no such entity). */
function x(page: Page, id: string): Promise<number | null> {
  return page.evaluate((entity) => {
    const transform = globalThis.__scenity?.document().entities[entity]?.components.transform as
      { position?: number[] } | undefined;
    return transform?.position?.[0] ?? null;
  }, id);
}

/** Move an entity to x (y and z stay) as one step of the history. */
async function moveX(page: Page, id: string, to: number): Promise<void> {
  const reason = await page.evaluate(
    async ([entity, value]) => {
      const api = globalThis.__scenity;
      const transform = api?.document().entities[entity as string]?.components.transform as { position: number[] };
      const [, y, z] = transform.position;
      const path = `/entities/${String(entity)}/components/transform/position`;
      if (api === undefined) return "no page";
      return api.apply([{ op: "set", path, value: [value as number, y ?? 0, z ?? 0] }]);
    },
    [id, to],
  );
  expect(reason).toBeNull();
}

function active(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => globalThis.__scenity?.scenes?.().active);
}

function diskX(scene: string, id: string): number | undefined {
  const doc = JSON.parse(readFileSync(join(dir, scene), "utf8")) as {
    entities: Record<string, { components: { transform?: { position?: number[] } } }>;
  };
  return doc.entities[id]?.components.transform?.position?.[0];
}

test("two scenes of one project, each with its own undo history; save as; a reload shows both", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const mainBefore = readFileSync(join(dir, MAIN), "utf8");
  // The start screen: the project name, its scene with the poster, New scene.
  await startScreen(page);
  await expect(page.getByTestId("start-project")).toHaveText("Showroom");
  const card = page.locator(`[data-testid="start-scene"][data-path="${MAIN}"]`);
  await expect(card.locator("img")).toHaveCount(1);
  await card.locator("a").click();
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  expect(await active(page)).toBe(MAIN);
  // The open scenes are tabs (the page has no scene select).
  await expect(page.getByTestId("scene-tabs")).toBeVisible();
  await expect(page.getByTestId("scene-switch")).toHaveCount(0);
  await expect(page.getByTestId("scene-tab")).toHaveCount(1);
  // Main: two steps (the table, then the shelf).
  await moveX(page, "table", 1.2);
  await moveX(page, "shelf", -2);
  // A new scene of the project: written, listed and open; a crate goes in and moves.
  const created = await page.evaluate(() => globalThis.__scenity?.newScene?.("Second room"));
  expect(created).toEqual({ ok: true, path: SECOND });
  expect(await active(page)).toBe(SECOND);
  expect(page.url()).toContain(`scene=${encodeURIComponent(SECOND)}`);
  expect(await x(page, "table")).toBeNull();
  const crate = { transform: { position: [0, 0, 0] }, shape: { kind: "box", size: [0.5, 0.5, 0.5] } };
  const added = await page.evaluate(
    (components) =>
      globalThis.__scenity?.apply([{ op: "add", id: "crate", entity: { parent: null, index: 0, components } }]),
    crate,
  );
  expect(added).toBeNull();
  await moveX(page, "crate", 0.8);
  expect((await page.evaluate(() => globalThis.__scenity?.stats()))?.entities).toBe(1);
  // Two scenes open as tabs; each one has the mark of its unsaved changes.
  const tabs = page.getByTestId("scene-tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("data-active", "");
  await expect(tabs.nth(0)).toHaveAttribute("data-dirty", "");
  // Return to main by its tab: its edits are there, and an undo cancels only its last step.
  await tabs.nth(0).getByTestId("scene-tab-name").click();
  await expect.poll(() => active(page)).toBe(MAIN);
  expect(await x(page, "table")).toBe(1.2);
  expect(await x(page, "shelf")).toBe(-2);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect(await x(page, "shelf")).toBe(-2.2);
  expect(await x(page, "table")).toBe(1.2);
  expect((await page.evaluate(() => globalThis.__scenity?.stats()))?.entities).toBeGreaterThan(10);
  // The second scene keeps its crate and its own steps.
  const openScenes = await page.evaluate(() => globalThis.__scenity?.scenes?.().open);
  expect(openScenes?.map((item) => [item.path, item.dirty])).toEqual([
    [MAIN, true],
    [SECOND, true],
  ]);
  expect(await page.evaluate((path) => globalThis.__scenity?.openScene?.(path), SECOND)).toBeNull();
  expect(await x(page, "crate")).toBe(0.8);
  const second = await page.evaluate(() => globalThis.__scenity?.save(false, "e2e: a new scene with no floor"));
  expect(second?.ok).toBe(true);
  // Save as: main goes to a new path; the file of main stays as it was.
  expect(await page.evaluate((path) => globalThis.__scenity?.openScene?.(path), MAIN)).toBeNull();
  const saved = await page.evaluate((path) => globalThis.__scenity?.saveSceneAs?.(path), COPY);
  expect(saved?.ok).toBe(true);
  expect(await active(page)).toBe(COPY);
  expect(readFileSync(join(dir, MAIN), "utf8")).toBe(mainBefore);
  expect(diskX(COPY, "table")).toBe(1.2);
  expect(diskX(COPY, "shelf")).toBe(-2.2);
  expect(diskX(SECOND, "crate")).toBe(0.8);
  // A reload: the start screen lists both scenes and the copy; each opens with its saved edits.
  await startScreen(page);
  const listed = await page.evaluate(() => globalThis.__scenityStart?.scenes.map((scene) => scene.path));
  expect(listed).toEqual(expect.arrayContaining([MAIN, SECOND, COPY]));
  const recent = await page.evaluate(() => globalThis.__scenityStart?.recent);
  expect(recent?.[0]).toBe(COPY);
  await open(page, COPY);
  expect(await x(page, "table")).toBe(1.2);
  expect(await x(page, "shelf")).toBe(-2.2);
  await open(page, SECOND, null);
  expect(await x(page, "crate")).toBe(0.8);
});

test("a close with unsaved changes asks first; the last close shows the start screen", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, MAIN);
  await moveX(page, "table", 1.4);
  const closing = page.evaluate(() => globalThis.__scenity?.closeScene?.());
  await expect(page.getByTestId("close-cancel")).toBeVisible();
  await page.getByTestId("close-cancel").click();
  expect(await closing).toMatchObject({ closed: false, active: MAIN });
  // The × of the tab closes the scene, with the same question.
  await page.locator('[data-testid="scene-tab"][data-active]').getByTestId("scene-tab-close").click();
  await page.getByTestId("close-discard").click();
  await expect(page.getByTestId("scene-start")).toHaveAttribute("data-ready", "1", READY);
  expect(diskX(MAIN, "table")).toBe(1.6);
});
