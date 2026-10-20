// SPDX-License-Identifier: Apache-2.0
// The material editor: a material change saves to its asset and shows on each user of the asset. The spec opens the
// materials scene of samples/gltf-samples in the edit mode. It assigns the checker standard material to a second entity
// (a part of the UnlitTest model) and opens the material from the asset browser. It changes the roughness and the
// colour in the material panel: both users change at once with no page reload. Save writes the material file (and the
// scene file with the assignment). A reload shows both users with the new values. The spec starts the dev server of
// the scene page on a copy of the samples in a temp folder, so the files of the repository never change. Run it alone
// under the GPU lock:
//   bunx --bun playwright test scene-materials --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sceneCanvasShot } from "../support/sceneCanvas";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SAMPLES = join(LABS_ROOT, "../../samples/gltf-samples");
const SCENE = "scenes/materials.scene.json";
const STANDARD = "01M51H7Y9ZE026AZ1AQJ288Y3V";
const STANDARD_FILE = "assets/materials/standard.material.json";
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 150_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-materials-"));
  for (const part of ["assets", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SAMPLES, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ mats: dir });
  origin = server.origin;
  key = server.keys.mats ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy of the materials scene in the edit mode and wait for the first frame with every asset. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=${SCENE}&camera=front&edit=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

/** A canvas point (CSS pixels) where the pick finds an entity (and a node of its model). */
async function pointOn(page: Page, entity: string, node?: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(
    async ({ id, part }) => {
      const canvas = document.querySelector("canvas");
      const width = canvas?.clientWidth ?? 0;
      const height = canvas?.clientHeight ?? 0;
      // The points of the middle of a part first: a point at the edge of a ball mixes it with the floor.
      const points: { x: number; y: number }[] = [];
      for (let y = height * 0.2; y < height * 0.9; y += 6) {
        for (let x = width * 0.1; x < width * 0.9; x += 6) points.push({ x, y });
      }
      const hits: { x: number; y: number }[] = [];
      for (const point of points) {
        const hit = await globalThis.__scenity?.pick(point.x, point.y);
        if (hit?.entity !== id) continue;
        if (part !== undefined && hit.target?.id !== part) continue;
        hits.push(point);
      }
      if (hits.length === 0) return null;
      const mean = (key: "x" | "y") => hits.reduce((sum, hit) => sum + hit[key], 0) / hits.length;
      const centre = { x: mean("x"), y: mean("y") };
      hits.sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));
      return hits[0] ?? null;
    },
    { id: entity, part: node },
  );
  if (found === null) throw new Error(`no point of the canvas shows ${entity} ${node ?? ""}`);
  return found;
}

/** The mean colour (0 to 255) of a block of 7 × 7 pixels around each point of a canvas picture. */
async function colours(
  context: BrowserContext,
  png: Buffer,
  points: readonly { x: number; y: number }[],
): Promise<[number, number, number][]> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ({ data, at }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context2d = canvas.getContext("2d");
        if (context2d === null) throw new Error("no 2D context");
        context2d.drawImage(bitmap, 0, 0);
        return at.map((point) => {
          const block = context2d.getImageData(Math.round(point.x) - 3, Math.round(point.y) - 3, 7, 7).data;
          const sum = [0, 0, 0];
          for (let index = 0; index < block.length; index += 4) {
            for (let channel = 0; channel < 3; channel += 1)
              sum[channel] = (sum[channel] ?? 0) + (block[index + channel] ?? 0);
          }
          return sum.map((value) => value / 49) as [number, number, number];
        });
      },
      { data: png.toString("base64"), at: points },
    );
  } finally {
    await page.close();
  }
}

/** The material part of the script API of the page (scene/material/materialApi.ts) that the spec calls. */
interface MaterialPage {
  materialAssign(entity: string, part: string | null, ref: string | null): Promise<string | null>;
}

/** True for a red colour: much more red than green and blue. */
function red([r, g, b]: readonly number[]): boolean {
  return (r ?? 0) > 60 && (r ?? 0) > 2.5 * Math.max(g ?? 0, b ?? 0);
}

test("a material change shows on each user at once, saves to its asset and shows after a reload", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The second user: the blue part of the model takes the checker standard material (one step of the history).
  const reason = await page.evaluate(async (ref) => {
    const api = globalThis.__scenity as unknown as MaterialPage;
    return api.materialAssign("model", "mesh:Blue_Object", ref);
  }, `asset:${STANDARD}`);
  expect(reason).toBeNull();
  const points = [await pointOn(page, "sphere-standard"), await pointOn(page, "model", "Blue_Object")];
  const before = await colours(context, await sceneCanvasShot(page), points);
  expect(before.some(red)).toBe(false);
  // A mark of this page: a reload would lose it.
  await page.evaluate(() => {
    (globalThis as unknown as { materialMark: number }).materialMark = 1;
  });
  // Open the material from the asset browser.
  await page.getByTestId(`asset-tile-${STANDARD}`).click();
  await page.getByTestId("asset-edit-material").click();
  await expect(page.getByTestId("material-panel")).toHaveAttribute("data-material", `asset:${STANDARD}`);
  await expect(page.getByTestId("material-users")).toHaveText("Used by 2 entities");
  // The roughness and the colour change in the panel; the scene shows both at once.
  const roughness = page.getByTestId("material-field-roughness");
  await roughness.fill("1");
  await roughness.press("Enter");
  const colour = page.getByTestId("material-field-colour-hex");
  await colour.fill("#ff0000");
  await colour.press("Enter");
  await expect(page.getByTestId("material-panel")).toHaveAttribute("data-dirty", "1");
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  await expect
    .poll(async () => (await colours(context, await sceneCanvasShot(page), points)).every(red), { timeout: 10_000 })
    .toBe(true);
  expect(await page.evaluate(() => (globalThis as unknown as { materialMark?: number }).materialMark)).toBe(1);
  // Save writes the material asset and the scene with the assignment, through the canonical writer.
  await page.getByTestId("material-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  await expect(page.getByTestId("material-panel")).toHaveAttribute("data-dirty", "0");
  const material = JSON.parse(readFileSync(join(dir, STANDARD_FILE), "utf8")) as Record<string, unknown>;
  expect(material).toMatchObject({ colour: "#ff0000", roughness: 1, type: "standard", name: "Checker standard" });
  const scene = JSON.parse(readFileSync(join(dir, SCENE), "utf8")) as {
    entities: Record<string, { components: { model?: { materials?: Record<string, unknown> } } }>;
  };
  expect(scene.entities.model?.components.model?.materials?.["mesh:Blue_Object"]).toEqual({
    material: `asset:${STANDARD}`,
  });
  // A reload shows both users with the saved values.
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const again = await colours(context, await sceneCanvasShot(page), points);
  expect(again.every(red)).toBe(true);
});

test("the material steps by drag and drop: a material onto a part of the view, a texture onto a slot", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const view = page.getByTestId("scene-view");
  const tile = page.getByTestId(`asset-tile-${STANDARD}`);
  await expect(tile).toBeVisible(READY);
  // A drop of the material tile on a part of the model assigns it to that mesh (one step).
  const part = await pointOn(page, "model");
  const node = await page.evaluate(
    async (at) => (await globalThis.__scenity?.pick(at.x, at.y))?.target?.id ?? "",
    part,
  );
  expect(node).not.toBe("");
  await tile.dragTo(view, { targetPosition: part });
  await expect(view).toHaveAttribute("data-material-drop", `model mesh:${node}`, READY);
  const materials = () =>
    page.evaluate(
      () =>
        (globalThis.__scenity?.document().entities.model?.components.model as { materials?: Record<string, unknown> })
          .materials,
    );
  expect((await materials())?.[`mesh:${node}`]).toEqual({ material: `asset:${STANDARD}` });
  // A drop on a shape gives the shape the material.
  await tile.dragTo(view, { targetPosition: await pointOn(page, "sphere-phong") });
  await expect(view).toHaveAttribute("data-material-drop", "sphere-phong", READY);
  // The panel of the material: a preset in one step, then a texture tile onto the colour slot.
  await tile.click();
  await page.getByTestId("asset-edit-material").click();
  const panel = page.getByTestId("material-panel");
  await expect(panel).toHaveAttribute("data-material", `asset:${STANDARD}`);
  await panel.locator('[data-testid="material-preset"][data-preset="metal"]').click();
  await expect(page.getByTestId("material-field-metalness")).toHaveValue("1");
  // The checker texture of the project.
  const texture = page.getByTestId("asset-tile-01M51H7Y1XMRMVK5YYEV7E6Z79");
  await texture.dragTo(page.getByTestId("material-slot-colour-texture"));
  await expect(page.getByTestId("material-slot-colour-texture")).not.toHaveValue("");
  await expect(page.getByTestId("material-slot-colour-picture")).toBeVisible();
});
