// SPDX-License-Identifier: Apache-2.0
// The promote of a dropped model on the scene page: drop, promote, save and reopen show the model in the scene with no
// TypeScript change. The spec copies the showroom to a temp folder and starts the dev server of the scene page on it
// (no watch), so the files of the repository never change. In the edit mode, the spec drops a GLB box (made by the
// spec, CC0) on the floor. The box becomes a project asset (the file, its record, the rights record of the imports).
// It also becomes an entity with a `model` component at the drop point: one undo step. The release gate stops the new
// asset (licence not known). A save writes the scene file. A reload draws the model (a pick at the drop point hits the
// entity), although the showroom build does not hold the asset. Run it alone under the GPU lock:
//   SCENITY_SCENE_NO_WATCH=1 bunx --bun playwright test scene-promote --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { releaseCheck } from "../../../../packages/assets/src/release/index";
import { boxGlb } from "./boxGlb";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const MAIN = "scenes/main.scene.json";
const READY = { timeout: 60_000 };

// The panels of the edit mode (the hierarchy, the inspector and the asset dock) cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-promote-"));
  for (const part of ["assets", "build", "rights", "scenes", "stills", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ promote: dir });
  origin = server.origin;
  key = server.keys.promote ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=${MAIN}&camera=front&edit=1`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-hierarchy", "1", READY);
}

function ids(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).sort());
}

/** A point of the canvas (CSS pixels from its corner) that shows the floor, away from the furniture. */
async function floorPoint(page: Page): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async () => {
    const api = globalThis.__scenity;
    const canvas = document.querySelector("canvas");
    if (api === undefined || canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    for (let y = box.height * 0.85; y > box.height * 0.5; y -= 10) {
      for (let x = box.width * 0.3; x < box.width * 0.7; x += 10) {
        if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
        const hit = await api.pick(x, y);
        if (hit?.entity === "floor" && Math.abs(hit.point[1]) < 0.01) return { x, y };
      }
    }
    return null;
  });
  if (found === null) throw new Error("no point of the canvas shows the floor");
  return found;
}

/** Drop a file on the canvas at a point, as a drop of a file of the desktop does. */
async function dropModel(page: Page, name: string, bytes: Buffer, at: { x: number; y: number }): Promise<void> {
  await page.evaluate(
    ({ fileName, data, x, y }) => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) throw new Error("no canvas");
      const box = canvas.getBoundingClientRect();
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], fileName, { type: "model/gltf-binary" }));
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: box.left + x,
        clientY: box.top + y,
      };
      canvas.dispatchEvent(new DragEvent("dragover", init));
      canvas.dispatchEvent(new DragEvent("drop", init));
    },
    { fileName: name, data: [...bytes], x: at.x, y: at.y },
  );
}

test("a dropped model becomes a project asset and an entity; save and reload show it", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const start = await ids(page);
  const view = page.getByTestId("scene-view");
  const at = await floorPoint(page);
  await dropModel(page, "Promo Box.glb", boxGlb(), at);
  await expect(view).toHaveAttribute("data-promoted", /.+/, READY);
  const asset = (await view.getAttribute("data-promoted")) ?? "";
  const added = (await view.getAttribute("data-drop")) ?? "";
  expect(added).toBe("promo-box");
  expect(await view.getAttribute("data-promote-rights")).toContain("the release gate stops the asset");

  // The project asset: the file, its record (rights/imports.yaml) and the asset database.
  const record = JSON.parse(readFileSync(join(dir, "assets/sources/Promo_Box.glb.meta.json"), "utf8")) as {
    id: string;
    rights: string;
  };
  expect(record).toMatchObject({ id: asset, rights: "../../rights/imports.yaml" });
  expect(readFileSync(join(dir, "rights/imports.yaml"), "utf8")).toContain("webDelivery: pending");
  expect(existsSync(join(dir, ".scenity/imports", asset))).toBe(true);
  const gate = await releaseCheck(dir);
  expect(gate.passed).toBe(false);
  expect(gate.findings.filter((finding) => finding.level === "error").every((f) => f.assets.includes(asset))).toBe(
    true,
  );

  // The entity: a model of the new asset on the floor at the drop point; one undo step.
  const entity = await page.evaluate((id) => globalThis.__scenity?.document().entities[id], added);
  expect(entity?.components.model).toEqual({ asset: `asset:${asset}` });
  const position = (entity?.components.transform as { position: number[] }).position;
  expect(position[1]).toBeCloseTo(0, 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => ids(page)).toEqual(start);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => ids(page)).toContain(added);

  // Save, then reload: the model shows (a pick at the drop point hits the entity).
  const saved = await page.evaluate(() => globalThis.__scenity?.save());
  expect(saved?.ok, JSON.stringify(saved)).toBe(true);
  const disk = JSON.parse(readFileSync(join(dir, MAIN), "utf8")) as {
    entities: Record<string, { components: Record<string, unknown> }>;
  };
  expect(disk.entities[added]?.components.model).toEqual({ asset: `asset:${asset}` });
  await open(page);
  expect(await ids(page)).toContain(added);
  const picked = (): Promise<string | null> =>
    page.evaluate(async ([x, y]) => (await globalThis.__scenity?.pick(x ?? 0, y ?? 0))?.entity ?? null, [at.x, at.y]);
  await expect.poll(picked, READY).toBe(added);
  await page.screenshot({ path: test.info().outputPath("promoted-after-reload.png") });
});
