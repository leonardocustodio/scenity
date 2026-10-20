// SPDX-License-Identifier: Apache-2.0
// The hot reload of assets in dev: a new texture of a model and a new environment
// map show in the open scene in less than 2 s, with no page reload. The spec starts the dev server of the scene page
// (vite.scene.config.ts) on a copy of the showroom in a temp folder, so the files of the repository never change. The
// time runs from the write of the file to the answer of the "load" with `reload`: the core sends it after the frame
// that shows the new asset. Run it alone under the GPU lock: bunx --bun playwright test scene-hot-reload --workers=1.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SOURCES = "assets/sources";
const TABLE_TEXTURE = `${SOURCES}/WoodenTable_01/textures/WoodenTable_01_diff_1k.jpg`;
const ENVIRONMENT = `${SOURCES}/studio_small_09_1k.hdr`;
const LIMIT_MS = 2000;
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/**
 * A Radiance HDR file of one orange colour: flat scanlines (the first byte of a pixel is not 2, so no RLE). It has the
 * size of the showroom map: a new size makes the PMREM generator compile its shaders again, which takes seconds.
 */
function orangeHdr(width = 1024, height = 512): Buffer {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${String(height)} +X ${String(width)}\n`);
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) pixels.set([240, 110, 20, 130], index * 4);
  return Buffer.concat([head, pixels]);
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-hot-reload-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer(
    { hot: dir },
    // The spec edits sources of the project: the dev server watches the files.
    { SCENITY_SCENE_NO_WATCH: "0" },
  );
  origin = server.origin;
  key = server.keys.hot ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy of the showroom and wait for the first frame with every asset; mark the page to see a reload. */
async function open(page: Page, worker: string): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&worker=${worker}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => {
    (globalThis as { __hotMarker?: number }).__hotMarker = 1;
  });
}

async function shot(page: Page): Promise<Buffer> {
  await page.evaluate(() => globalThis.__scenity?.frame());
  return page.getByTestId("scene-view").screenshot({ animations: "disabled" });
}

/** The times of a reload (ms): from the write of the file, of the import on the server, and from the event. */
interface ReloadTimes {
  readonly ms: number;
  readonly importMs: number;
  readonly pageMs: number;
}

/** Write a file of the project copy and wait for the reload of `id`. */
async function change(page: Page, id: string, write: () => void): Promise<ReloadTimes> {
  const count = await page.evaluate(() => globalThis.__scenity?.reloads?.().length ?? -1);
  expect(count).toBeGreaterThanOrEqual(0);
  const start = Date.now();
  write();
  await page.waitForFunction(
    ([asset, before]) => (globalThis.__scenity?.reloads?.() ?? []).slice(before).some((each) => each.id === asset),
    [id, count] as const,
    { timeout: 15_000 },
  );
  const ms = Date.now() - start;
  const reload = await page.evaluate(() => globalThis.__scenity?.reloads?.().at(-1));
  expect(reload?.ok).toBe(true);
  return { ms, importMs: reload?.importMs ?? -1, pageMs: reload?.ms ?? -1 };
}

/** The page did not load again: the marker, the URL and the camera stay. */
async function expectSamePage(page: Page, url: string): Promise<void> {
  expect(await page.evaluate(() => (globalThis as { __hotMarker?: number }).__hotMarker)).toBe(1);
  expect(page.url()).toBe(url);
}

for (const path of [
  { name: "render worker", worker: "1" },
  { name: "main-thread core", worker: "0" },
] as const) {
  test(`a new texture of a model shows in less than 2 s with no page reload: ${path.name}`, async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
    await open(page, path.worker);
    const url = page.url();
    const before = await shot(page);
    // The diffuse texture of the armchair (a fabric) on the wooden table.
    const fabric = join(SHOWROOM, `${SOURCES}/ArmChair_01/textures/Armchair_01_diff_1k.jpg`);
    const times = await change(page, "01M4ZPXYG50NAV41FPDE38QB7E", () => {
      cpSync(fabric, join(dir, TABLE_TEXTURE));
    });
    const after = await shot(page);
    const diff = await diffFrames(context, before, after);
    console.log(
      `[hot-reload] ${JSON.stringify({ path: path.worker, asset: "texture", ...times, differ: diff.differ })}`,
    );
    expect(diff.differ).toBeGreaterThan(1000);
    expect(times.ms).toBeLessThan(LIMIT_MS);
    await expectSamePage(page, url);
    // Write the texture of the repository again for the next test. The page then draws the import of the source, not
    // the built LOD. Thus the frame is not the first frame: it differs from the frame of the fabric.
    await change(page, "01M4ZPXYG50NAV41FPDE38QB7E", () => {
      cpSync(join(SHOWROOM, TABLE_TEXTURE), join(dir, TABLE_TEXTURE));
    });
    const back = await shot(page);
    for (const [name, body] of [
      ["before.png", before],
      ["after.png", after],
      ["back.png", back],
    ] as const) {
      writeFileSync(testInfo.outputPath(name), body);
    }
    expect((await diffFrames(context, after, back)).differ).toBeGreaterThan(1000);
  });
}

test("a new environment map shows in less than 2 s with no page reload", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "1");
  const url = page.url();
  const before = await shot(page);
  const times = await change(page, "01M4ZPXYG6S1R09H3MDXC5VXKQ", () => {
    writeFileSync(join(dir, ENVIRONMENT), orangeHdr());
  });
  const after = await shot(page);
  const diff = await diffFrames(context, before, after);
  console.log(`[hot-reload] ${JSON.stringify({ path: "1", asset: "environment", ...times, differ: diff.differ })}`);
  expect(diff.differ).toBeGreaterThan(1000);
  expect(times.ms).toBeLessThan(LIMIT_MS);
  await expectSamePage(page, url);
});

test("in the edit mode a changed source gives one toast and the new model", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  // The panels of the window mount after the first frame and the Scene view takes its last size then.
  await expect(page.locator("#scene-hierarchy")).toBeVisible(READY);
  const before = await shot(page);
  const fabric = join(SHOWROOM, `${SOURCES}/ArmChair_01/textures/Armchair_01_diff_1k.jpg`);
  await change(page, "01M4ZPXYG50NAV41FPDE38QB7E", () => {
    cpSync(fabric, join(dir, TABLE_TEXTURE));
  });
  const toasts = page.getByTestId("studio-toast").filter({ hasText: "changed: the view shows the new import" });
  await expect(toasts).toHaveCount(1);
  expect((await diffFrames(context, before, await shot(page))).differ).toBeGreaterThan(1000);
  await change(page, "01M4ZPXYG50NAV41FPDE38QB7E", () => {
    cpSync(join(SHOWROOM, TABLE_TEXTURE), join(dir, TABLE_TEXTURE));
  });
});
