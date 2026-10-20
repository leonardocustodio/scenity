// SPDX-License-Identifier: Apache-2.0
// The entity commands of the scene page. Each action has an undo step. The spec copies the showroom to a temp folder
// with a second scene. Then, in the edit mode, ⌘D duplicates the ottoman, and the context menu of the hierarchy deletes
// the armchair. A drag of the lantern tile of the asset browser drops a new lantern on the top of the table. Each
// action undoes. The drop is redone and saved. ⌘C copies the table with its children, the second scene opens, and ⌘V
// pastes them (the asset references stay). The paste undoes, redoes and saves. The files of the repository never
// change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-entities --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const MAIN = "scenes/main.scene.json";
const SECOND = "scenes/second.scene.json";
const LANTERN = "01M4ZPXYG26FPR940EDPJM9FCD";
const READY = { timeout: 60_000 };

// The panels of the edit mode (the hierarchy, the inspector and the asset dock) cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/** The second scene of the copy: the floor, the light and the front camera of the showroom. */
function writeSecondScene(): void {
  const main = JSON.parse(readFileSync(join(dir, MAIN), "utf8")) as { entities: Record<string, { index: number }> };
  const keep = ["floor", "fill", "front"];
  const entities = Object.fromEntries(keep.map((id, index) => [id, { ...main.entities[id], index }]));
  writeFileSync(
    join(dir, SECOND),
    `${JSON.stringify({ format: "scenity.scene/1", id: "second", entities }, null, 2)}\n`,
  );
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-entities-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  writeSecondScene();
  server = await startSpecServer({ entities: dir });
  origin = server.origin;
  key = server.keys.entities ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open a scene of the copy in the edit mode and wait for the frame and the hierarchy panel. */
async function open(page: Page, scene: string): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=${scene}&camera=front&edit=1`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-hierarchy", "1", READY);
}

/** The entity IDs of the document of the page. */
function ids(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).sort());
}

function selection(page: Page): Promise<readonly string[] | undefined> {
  return page.evaluate(() => globalThis.__scenity?.selection?.());
}

/** Select entities through the script API and wait for the frame. */
async function select(page: Page, entities: string[]): Promise<void> {
  await page.evaluate((list) => globalThis.__scenity?.select?.(list), entities);
}

/** A point of the canvas (CSS pixels from its corner) that shows the top of the table, and the height of the top. */
async function tableTop(page: Page): Promise<{ x: number; y: number; top: number }> {
  const found = await page.evaluate(async () => {
    const api = globalThis.__scenity;
    const report = await api?.inspect?.();
    const top = report?.entities.find((entity) => entity.id === "table")?.ownBounds?.max[1];
    const canvas = document.querySelector("canvas");
    if (api === undefined || top === undefined || canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    for (let y = box.height * 0.3; y < box.height * 0.9; y += 10) {
      for (let x = box.width * 0.1; x < box.width * 0.9; x += 10) {
        if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
        const hit = await api.pick(x, y);
        if (hit?.entity === "table" && Math.abs(hit.point[1] - top) < 0.01) return { x, y, top };
      }
    }
    return null;
  });
  if (found === null) throw new Error("no point of the canvas shows the top of the table");
  return found;
}

interface DiskEntity {
  readonly parent: string | null;
  readonly components: Record<string, Record<string, unknown>>;
}

function disk(scene: string): Record<string, DiskEntity> {
  return (JSON.parse(readFileSync(join(dir, scene), "utf8")) as { entities: Record<string, DiskEntity> }).entities;
}

test("duplicate, delete and a drop of an asset onto the table, each with an undo step; save", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, MAIN);
  const start = await ids(page);
  const view = page.getByTestId("scene-view");

  // ⌘D duplicates the selected ottoman beside it and selects the copy. ⌘Z removes it.
  await select(page, ["ottoman"]);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => ids(page)).toContain("ottoman-2");
  expect(await selection(page)).toEqual(["ottoman-2"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);

  // The context menu of a hierarchy row deletes the armchair. ⌘Z restores it.
  await page.getByTestId("hierarchy-row-armchair").click({ button: "right" });
  await page.getByTestId("hierarchy-menu-delete").click();
  await expect.poll(() => ids(page)).not.toContain("armchair");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);
  // Delete with the keys: the selected ottoman goes. ⌘Z restores it.
  await select(page, ["ottoman"]);
  await page.keyboard.press("Delete");
  await expect.poll(() => ids(page)).not.toContain("ottoman");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);

  // A drag of the lantern tile onto the top of the table adds a lantern with a model there.
  const point = await tableTop(page);
  const tile = page.getByTestId(`asset-tile-${LANTERN}`);
  await expect(tile).toBeVisible(READY);
  await tile.dragTo(view, { targetPosition: { x: point.x, y: point.y } });
  await expect(view).not.toHaveAttribute("data-drop", "", READY);
  const added = (await view.getAttribute("data-drop")) ?? "";
  expect(start).not.toContain(added);
  const entity = await page.evaluate((id) => globalThis.__scenity?.document().entities[id], added);
  expect(entity?.parent).toBeNull();
  expect(entity?.components.model).toEqual({ asset: `asset:${LANTERN}` });
  const position = (entity?.components.transform as { position: number[] }).position;
  expect(position[1]).toBeCloseTo(point.top, 2);
  expect(await selection(page)).toEqual([added]);
  // The core draws the new model: a pick at the drop point hits it.
  const picked = (): Promise<string | null> =>
    page.evaluate(
      async ([x, y]) => (await globalThis.__scenity?.pick(x ?? 0, y ?? 0))?.entity ?? null,
      [point.x, point.y],
    );
  await expect.poll(picked, READY).toBe(added);
  await page.screenshot({ path: test.info().outputPath("drop-on-table.png") });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => ids(page)).toContain(added);

  // Save: the file holds the new lantern.
  expect((await page.evaluate(() => globalThis.__scenity?.save()))?.ok).toBe(true);
  expect(disk(MAIN)[added]?.components.model).toEqual({ asset: `asset:${LANTERN}` });
});

test("copy the table in one scene, paste it into a second scene of the project; undo; save", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, MAIN);
  await select(page, ["table"]);
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => globalThis.localStorage.getItem("scenity.scene.clipboard") !== null))
    .toBe(true);

  await open(page, SECOND);
  const start = await ids(page);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => ids(page)).toContain("table");
  expect(await ids(page)).toEqual([...start, "lantern", "lantern-light", "table"].sort());
  expect(await selection(page)).toEqual(["table"]);
  const lantern = await page.evaluate(() => globalThis.__scenity?.document().entities.lantern);
  expect(lantern?.parent).toBe("table");
  expect(lantern?.components.model).toEqual({ asset: `asset:${LANTERN}` });
  await page.screenshot({ path: test.info().outputPath("paste-second-scene.png") });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => ids(page)).toContain("lantern-light");

  expect((await page.evaluate(() => globalThis.__scenity?.save()))?.ok).toBe(true);
  const saved = disk(SECOND);
  expect(saved.lantern?.parent).toBe("table");
  expect(saved.lantern?.components.model).toEqual({ asset: `asset:${LANTERN}` });
  expect(saved["lantern-light"]?.parent).toBe("lantern");
});
