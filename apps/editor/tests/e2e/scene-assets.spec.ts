// SPDX-License-Identifier: Apache-2.0
// The asset browser of the scene page. The showroom assets show, and a drop imports. The spec copies the showroom to a
// temp folder and starts the dev server of the scene page on it, so the files of the repository never change. In the
// edit mode, the dock at the bottom shows the 7 assets of the showroom with their stills. The spec drops a PNG that it
// makes (CC0) on the browser: the PNG becomes a new tile with a record on the disk. The Import button imports a second
// file. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-assets --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { encode } from "fast-png";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };
const LANTERN = "01M4ZPXYG26FPR940EDPJM9FCD";
const STUDIO_SKY = "01M4ZPXYG6S1R09H3MDXC5VXKQ";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-assets-"));
  for (const part of ["assets", "build", "rights", "scenes", "stills", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ assets: dir });
  origin = server.origin;
  key = server.keys.assets ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** A PNG of 8 by 8 pixels of one colour, made by the spec (CC0). */
function png(red: number): Buffer {
  const data = new Uint8Array(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) data.set([red, 120, 40, 255], index * 4);
  return Buffer.from(encode({ width: 8, height: 8, data, channels: 4 }));
}

/** Open the project. `count` is the number of assets: the imports of a test before add to the 7 of the showroom. */
async function open(page: Page, count: string | RegExp = "7"): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", count, READY);
}

/** Drop a file on the asset browser, as a drop of a file of the desktop does. */
async function dropFile(page: Page, name: string, bytes: Buffer): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ([fileName, data]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], fileName, { type: "image/png" }));
      return transfer;
    },
    [name, [...bytes]] as const,
  );
  const browser = page.getByTestId("asset-browser");
  await browser.dispatchEvent("dragover", { dataTransfer });
  await browser.dispatchEvent("drop", { dataTransfer });
}

test("the showroom assets show with their stills and their users", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const tiles = page.locator("[data-testid^='asset-tile-']");
  await expect(tiles).toHaveCount(7);
  await expect(page.locator("[data-testid^='asset-tile-'][data-still='1']")).toHaveCount(7);
  // Each still loads: the image has its pixels.
  await expect
    .poll(() =>
      page
        .getByTestId("asset-still")
        .evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length),
    )
    .toBe(7);
  await page.getByTestId("asset-kind-environment").click();
  await expect(tiles).toHaveCount(1);
  await page.getByTestId("asset-kind-environment").click();
  await page.getByTestId("asset-search").fill("lantern");
  await expect(tiles).toHaveCount(1);
  await page.getByTestId(`asset-tile-${LANTERN}`).click();
  await expect(page.getByTestId("asset-used-by").locator("[data-where='scene']")).toHaveCount(1);
  const drag = await page.getByTestId(`asset-tile-${LANTERN}`).getAttribute("draggable");
  expect(drag).toBe("true");
});

test("a drop imports a file: a new tile and a record on the disk", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await dropFile(page, "drop-chequer.png", png(220));
  // The import dialog shows the file with its importer. Import takes the defaults.
  const dialog = page.getByTestId("asset-import-dialog");
  await expect(dialog.getByTestId("asset-import-file")).toHaveText(/drop-chequer\.png/);
  await dialog.getByTestId("import-start").click();
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", "8", READY);
  await expect(page.getByTestId("asset-status")).toContainText("Imported drop-chequer.png");
  const record = join(dir, "assets/sources/drop-chequer.png.meta.json");
  expect(existsSync(record)).toBe(true);
  const { id } = JSON.parse(readFileSync(record, "utf8")) as { id: string };
  const tile = page.getByTestId(`asset-tile-${id}`);
  await expect(tile).toHaveAttribute("data-kind", "texture");
  await expect(tile).toHaveAttribute("data-still", "1");
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  expect(existsSync(join(dir, ".scenity/imports", id, "import.json"))).toBe(true);
  // The Import button takes a chosen file the same way.
  await page.getByTestId("asset-import-input").setInputFiles({
    name: "chosen.png",
    mimeType: "image/png",
    buffer: png(40),
  });
  // A rights record of the project at import replaces the default rights/imports.yaml.
  await dialog.getByTestId("import-rights").click();
  await page.getByRole("option", { name: /^polyhaven/ }).click();
  await dialog.getByTestId("import-start").click();
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", "9", READY);
  const chosen = join(dir, "assets/sources/chosen.png.meta.json");
  expect(existsSync(chosen)).toBe(true);
  expect((JSON.parse(readFileSync(chosen, "utf8")) as { rights: string }).rights).toBe("../../rights/polyhaven.yaml");
  // The queue shows the state of the file.
  await expect(page.locator('[data-testid="asset-import-row"][data-state="done"]')).toHaveText(/chosen\.png/);
  // A new rights record made in the dialog: the import takes it.
  await page
    .getByTestId("asset-import-input")
    .setInputFiles({ name: "made.png", mimeType: "image/png", buffer: png(60) });
  await dialog.getByTestId("import-new-rights").click();
  const form = dialog.getByTestId("rights-form");
  await form.getByTestId("rights-name").fill("kenney");
  await form.getByTestId("rights-source").fill("Kenney, https://kenney.nl");
  await form.getByTestId("rights-author").fill("Kenney");
  await form.getByTestId("rights-save").click();
  await expect(form).toHaveCount(0);
  expect(readFileSync(join(dir, "rights/kenney.yaml"), "utf8")).toContain('spdx: "CC0-1.0"');
  await dialog.getByTestId("import-start").click();
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", "10", READY);
  const made = JSON.parse(readFileSync(join(dir, "assets/sources/made.png.meta.json"), "utf8")) as { rights: string };
  expect(made.rights).toBe("../../rights/kenney.yaml");
});

test("an FBX import with no Blender shows the doctor fix", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  // The answer of the dev server on a machine with no Blender and no Docker (NO_BLENDER of @scenity/assets/blender).
  await page.route("**/assets.import", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, reason: "no Blender: FBX, OBJ and .blend files need Blender 5.2" }),
    }),
  );
  await open(page, /^\d+$/);
  await page
    .getByTestId("asset-import-input")
    .setInputFiles({ name: "crate.fbx", mimeType: "application/octet-stream", buffer: Buffer.from("Kaydara FBX") });
  const dialog = page.getByTestId("asset-import-dialog");
  await expect(dialog.getByTestId("asset-import-file")).toHaveText(/crate\.fbx/);
  await dialog.getByTestId("import-start").click();
  const row = page.locator('[data-testid="asset-import-row"][data-state="failed"]');
  await expect(row).toHaveText(/crate\.fbx/, READY);
  const fix = row.getByTestId("asset-import-fix");
  await expect(fix).toContainText("Blender 5.2");
  await expect(fix.getByRole("link", { name: "Install Blender" })).toHaveAttribute(
    "href",
    "https://www.blender.org/download/",
  );
});

/** A WAV file of 16-bit PCM: a tone of 440 Hz, 0.25 s at 8 kHz, made by the spec (CC0). */
function wav(): Buffer {
  const rate = 8000;
  const samples = rate / 4;
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    out.writeInt16LE(Math.round(Math.sin((index / rate) * 440 * 2 * Math.PI) * 12_000), 44 + index * 2);
  }
  return out;
}

/** Import one file with the defaults of the import dialog, and select its new tile. */
async function importOne(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.getByTestId("asset-import-input").setInputFiles({ name, mimeType, buffer });
  await page.getByTestId("asset-import-dialog").getByTestId("import-start").click();
  await expect(page.locator('[data-testid="asset-import-row"][data-state="done"]')).toHaveText(
    new RegExp(name.replace(".", "\\.")),
    READY,
  );
}

test("the asset inspector: the previews, the facts and an import again", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  const details = page.getByTestId("asset-details");
  // A model: the turntable, and the facts of the build.
  await page.getByTestId(`asset-tile-${LANTERN}`).click();
  await expect(details.getByTestId("asset-preview")).toHaveAttribute("data-preview", "turntable");
  await expect(details.getByTestId("asset-preview-canvas")).toHaveAttribute("data-ready", "1", READY);
  await expect(details.locator('[data-fact="asset-fact-lods"]')).toContainText("high");
  await expect(details.locator('[data-field="asset-record-importer"]')).toHaveText("gltf");
  // Import again with a changed setting: the record keeps it.
  await details.getByTestId("asset-reimport").locator(":scope > summary").click();
  await details.getByTestId("import-setting-maxTextureSize").fill("512");
  await details.getByTestId("import-setting-maxTextureSize").press("Tab");
  await details.getByTestId("asset-reimport-start").click();
  const record = join(dir, "assets/sources/Lantern_01/Lantern_01_1k.gltf.meta.json");
  await expect
    .poll(() => (JSON.parse(readFileSync(record, "utf8")) as { settings: { maxTextureSize?: number } }).settings)
    .toMatchObject({ maxTextureSize: 512 });
  // The copy of the showroom has no import stamps: the facts of the import report show after the import again.
  await expect(details.locator('[data-fact="asset-fact-meshes"]')).toHaveText(/^\d+$/, READY);
  await expect(details.locator('[data-fact="asset-fact-extent"]')).toContainText(" m");
  await expect(details.getByTestId("asset-preview-canvas")).toHaveAttribute("data-ready", "1", READY);
  // An environment map: the mirror and matte balls.
  await page.getByTestId(`asset-tile-${STUDIO_SKY}`).click();
  await expect(details.getByTestId("asset-preview")).toHaveAttribute("data-preview", "environment");
  await expect(details.getByTestId("asset-preview-canvas")).toHaveAttribute("data-ready", "1", READY);
  // A texture: the channels.
  await importOne(page, "inspect.png", "image/png", png(90));
  await expect(details.getByTestId("asset-preview-texture")).toHaveAttribute("data-ready", "1", READY);
  await details.getByTestId("asset-channel-a").click();
  await expect(details.getByTestId("asset-preview-texture")).toHaveAttribute("data-channel", "a");
  await expect(details.locator('[data-fact="asset-fact-pixels"]')).toHaveText("8 × 8");
  // A sound: the wave, the player and the length.
  await importOne(page, "tone.wav", "audio/wav", wav());
  await expect(details.getByTestId("asset-preview-wave")).toHaveAttribute("data-ready", "1", READY);
  await expect(details.locator("audio")).toHaveCount(1);
  await expect(details.locator('[data-fact="asset-fact-duration"]')).toHaveText("0.25 s");
});

test("a new import gets its still; a changed source marks its tile; Make stills draws it", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  await importOne(page, "still-me.png", "image/png", png(150));
  const record = join(dir, "assets/sources/still-me.png.meta.json");
  const { id } = JSON.parse(readFileSync(record, "utf8")) as { id: string };
  // The page draws the still of the new asset in a hidden still page: no command line.
  const still = join(dir, "stills", `${id}.webp`);
  type Stamps = { stills: Record<string, { renderer?: string } | undefined> };
  const stamps = () => (JSON.parse(readFileSync(join(dir, "stills/stills.json"), "utf8")) as Stamps).stills;
  await expect.poll(() => stamps()[id]?.renderer, READY).toMatch(/^[0-9a-f]{16}$/);
  expect(existsSync(still)).toBe(true);
  const tile = page.getByTestId(`asset-tile-${id}`);
  await expect(tile).toHaveAttribute("data-still-state", "current", READY);
  // A changed source makes the still stale: the tile has a mark, and Make stills draws it again.
  writeFileSync(join(dir, "assets/sources/still-me.png"), png(30));
  await page.getByTestId("asset-reload").click();
  await expect(tile).toHaveAttribute("data-still-state", "stale", READY);
  await expect(tile.getByTestId("asset-still-stale")).toBeVisible();
  await page.getByTestId("asset-make-stills").click();
  await expect(tile).toHaveAttribute("data-still-state", "current", READY);
  await expect(tile.getByTestId("asset-still-stale")).toHaveCount(0);
  await expect(page.getByTestId("asset-status")).toContainText("Made");
});

test("rights: marks on the tiles, one record for many assets, the licence policy", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  // The default rights record of an import is open: the release gate stops the new assets, and their tiles say so.
  await importOne(page, "rights-a.png", "image/png", png(10));
  await importOne(page, "rights-b.png", "image/png", png(20));
  const idOf = (name: string): string =>
    (JSON.parse(readFileSync(join(dir, `assets/sources/${name}.meta.json`), "utf8")) as { id: string }).id;
  const tiles = ["rights-a.png", "rights-b.png"].map((name) => page.getByTestId(`asset-tile-${idOf(name)}`));
  for (const tile of tiles) await expect(tile).toHaveAttribute("data-rights", "blocked", READY);
  await expect(page.getByTestId(`asset-tile-${LANTERN}`)).not.toHaveAttribute("data-rights", "blocked");
  // Mod and a click picks each tile; the rights bar gives one record to both.
  for (const tile of tiles) await tile.click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByTestId("asset-rights-bar");
  await expect(bar).toContainText("2 assets picked");
  await bar.getByTestId("asset-rights-record").click();
  await page.getByRole("option", { name: /^polyhaven/ }).click();
  await bar.getByTestId("asset-rights-assign").click();
  await expect(bar).toHaveCount(0);
  for (const name of ["rights-a.png", "rights-b.png"]) {
    const record = JSON.parse(readFileSync(join(dir, `assets/sources/${name}.meta.json`), "utf8")) as {
      rights: string;
    };
    expect(record.rights).toBe("../../rights/polyhaven.yaml");
  }
  for (const tile of tiles) await expect(tile).not.toHaveAttribute("data-rights", "blocked", READY);
  // The licence policy of the project: Accept adds an SPDX ID to `release.licences.allow`, × removes it.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.rights"));
  const panel = page.getByTestId("rights-panel");
  await expect(panel.locator('[data-spdx="CC0-1.0"]')).toBeVisible(READY);
  await expect(panel.locator('[data-record="polyhaven"]')).toHaveAttribute("data-accepted", "1");
  await panel.getByTestId("rights-policy-input").fill("CC-BY-4.0");
  await panel.getByTestId("rights-policy-add").click();
  await expect(panel.locator('[data-spdx="CC-BY-4.0"]')).toBeVisible();
  const allow = () =>
    (
      JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as {
        release: { licences: { allow: string[] } };
      }
    ).release.licences.allow;
  expect(allow()).toEqual(["CC0-1.0", "CC-BY-4.0"]);
  await panel.getByTestId("rights-policy-remove-CC-BY-4.0").click();
  await expect(panel.locator('[data-spdx="CC-BY-4.0"]')).toHaveCount(0);
  expect(allow()).toEqual(["CC0-1.0"]);
});

test("approvals: a role, a review that passes release-check, a stale approval", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.approvals"));
  const panel = page.getByTestId("approvals-panel");
  await panel.getByTestId("approvals-new-role").fill("art");
  await panel.getByTestId("approvals-new-label").fill("Art");
  await panel.getByTestId("approvals-add-role").click();
  await expect(panel.getByTestId("approvals-role")).toContainText("Art", READY);
  const row = panel.getByTestId(`approvals-row-${LANTERN}`);
  await expect(row).toHaveAttribute("data-state", "missing");
  await row.click();
  const review = panel.getByTestId("approvals-review");
  await review.getByTestId("approvals-reviewer").fill("A. Reviewer");
  await review.getByTestId("approvals-note").fill("The lantern reads well.");
  await review.getByTestId("approvals-approve").click();
  await expect(row).toHaveAttribute("data-state", "current", READY);
  const approval = JSON.parse(readFileSync(join(dir, `approvals/${LANTERN}-art.json`), "utf8")) as Record<
    string,
    unknown
  >;
  expect(approval).toMatchObject({ role: "art", reviewer: "A. Reviewer", verdict: "approved" });
  // The release gate reads the approval: the lantern has no approval finding.
  const check = Bun.spawnSync(["bun", "packages/assets/src/cli.ts", "release-check", dir, "--json"], {
    cwd: join(LABS_ROOT, "../.."),
  });
  const report = JSON.parse(check.stdout.toString()) as {
    findings: { check: string; subject: string; message: string }[];
  };
  const approvals = report.findings.filter((finding) => finding.check === "approval");
  expect(approvals.some((finding) => finding.subject !== LANTERN)).toBe(true);
  expect(approvals.filter((finding) => finding.subject === LANTERN)).toEqual([]);
  // A change of the source makes the approval stale.
  const gltf = join(dir, "assets/sources/Lantern_01/Lantern_01_1k.gltf");
  writeFileSync(gltf, `${readFileSync(gltf, "utf8")}\n`);
  await panel.getByTestId("approvals-refresh").click();
  await expect(row).toHaveAttribute("data-state", "stale", READY);
});

test("the release check runs from its panel and links each failure to its fix", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.release"));
  const panel = page.getByTestId("release-panel");
  await panel.getByTestId("release-run").click();
  // The imports of the tests before have the open rights record, and the role "art" waits for its reviews.
  await expect(panel.getByTestId("release-result")).toHaveAttribute("data-passed", "0", READY);
  const chosen = (
    JSON.parse(readFileSync(join(dir, "assets/sources/drop-chequer.png.meta.json"), "utf8")) as { id: string }
  ).id;
  const group = panel.locator(`[data-testid="release-group"][data-asset="${chosen}"]`);
  await expect(group.locator('[data-check="rights"]')).toHaveCount(1);
  await group.locator('[data-check="rights"]').getByTestId("release-fix-rights").click();
  await expect(page.getByTestId("rights-panel")).toBeVisible();
  await group.locator('[data-check="approval"]').first().getByTestId("release-fix-approval").click();
  await expect(page.getByTestId("approvals-panel")).toBeVisible();
  // The Approvals panel shares the bottom area with the release check: the release check returns to the front.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.release"));
  await group.getByTestId(`release-show-${chosen}`).click();
  await expect(page.getByTestId(`asset-tile-${chosen}`)).toHaveAttribute("aria-pressed", "true", READY);
});

test("a deleted source shows in Problems with a relink fix; a copied record gets a new ID", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  await importOne(page, "lost.png", "image/png", png(70));
  // The source moves into another folder: the record names a file that is not there.
  mkdirSync(join(dir, "assets/sources/moved"));
  renameSync(join(dir, "assets/sources/lost.png"), join(dir, "assets/sources/moved/lost.png"));
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.problems"));
  const panel = page.getByTestId("problems-panel");
  await panel.getByTestId("problems-refresh").click();
  const row = panel.getByTestId("problem-row").filter({ hasText: "lost.png.meta.json" });
  await expect(row.getByTestId("problem-title")).toContainText("The source of the asset record", READY);
  await row.locator('[data-fix="relink:assets/sources/moved/lost.png"]').click();
  await expect(row).toHaveCount(0, READY);
  const record = join(dir, "assets/sources/lost.png.meta.json");
  const relinked = JSON.parse(readFileSync(record, "utf8")) as { id: string; source: string };
  expect(relinked.source).toBe("moved/lost.png");
  // A copy of a record has the ID of the first one: the fix gives the copy a new ID.
  writeFileSync(
    join(dir, "assets/sources/moved/lost.png.meta.json"),
    JSON.stringify({ ...relinked, source: "lost.png" }),
  );
  await panel.getByTestId("problems-refresh").click();
  const twin = panel.getByTestId("problem-row").filter({ hasText: "the ID of another record" });
  await expect(twin).toHaveCount(1, READY);
  await twin.locator('[data-fix="new-id"]').click();
  await expect(twin).toHaveCount(0, READY);
  const ids = ["assets/sources/lost.png.meta.json", "assets/sources/moved/lost.png.meta.json"].map(
    (path) => (JSON.parse(readFileSync(join(dir, path), "utf8")) as { id: string }).id,
  );
  expect(new Set(ids).size).toBe(2);
});

test("the Export panel exports the scene as GLB, and the glTF validator finds no error", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.export"));
  const panel = page.getByTestId("export-panel");
  await expect(panel.getByTestId("export-scene")).toHaveValue("scenes/main.scene.json");
  await panel.getByTestId("export-out").fill("exports/showroom.glb");
  await panel.getByTestId("export-run").click();
  await expect(panel.getByTestId("export-validator")).toHaveAttribute("data-errors", "0", READY);
  await expect(panel.getByTestId("export-file")).toHaveText("exports/showroom.glb");
  const glb = readFileSync(join(dir, "exports/showroom.glb"));
  expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
});

test("the Project window: folders, a rename of a model folder keeps its ID, a drag moves an asset", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, /^\d+$/);
  const window = page.getByTestId("project-window");
  await expect(window).toBeVisible();
  await expect(page.getByTestId("asset-browser")).toBeVisible();
  // The folder tree: assets/sources lists the model folders.
  await window.locator('[data-testid="project-folder"][data-path="assets/sources"]').click();
  const entry = (path: string) => window.locator(`[data-testid="project-entry"][data-path="${path}"]`);
  await expect(entry("assets/sources/Lantern_01")).toHaveAttribute("data-kind", "folder");
  // F2 renames the folder of a model: its record goes with it, so the ID and each reference stay.
  await entry("assets/sources/Lantern_01").locator('[role="button"]').focus();
  await page.keyboard.press("F2");
  await window.getByTestId("project-rename").fill("Lantern_moved");
  await page.keyboard.press("Enter");
  await expect(entry("assets/sources/Lantern_moved")).toBeVisible();
  const list = await page.evaluate(async (project) => {
    const answer = await fetch(`/projects/${project}/assets.list.json`);
    return ((await answer.json()) as { assets: { id: string; source: string }[] }).assets;
  }, key);
  const lantern = list.find((asset) => asset.source.includes("Lantern_moved"));
  expect(lantern?.id).toBe("01M4ZPXYG26FPR940EDPJM9FCD");
  const users = await page.evaluate(
    () =>
      Object.values(globalThis.__scenity?.document().entities ?? {}).filter(
        (item) =>
          (item.components.model as { asset?: string } | undefined)?.asset === "asset:01M4ZPXYG26FPR940EDPJM9FCD",
      ).length,
  );
  expect(users).toBeGreaterThan(0);
  // A new folder at the root, then a drag of the environment map onto it in the tree.
  await window.locator('[data-testid="project-folder"][data-path=""]').click();
  await window.getByTestId("project-create").click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const folder = window.locator('[data-testid="project-folder"][data-path="New folder"]');
  await expect(folder).toBeVisible();
  await window.locator('[data-testid="project-folder"][data-path="assets/sources"]').click();
  await entry("assets/sources/studio_small_09_1k.hdr").locator('[role="button"]').dragTo(folder);
  await window.locator('[data-testid="project-folder"][data-path="New folder"]').click();
  await expect(entry("New folder/studio_small_09_1k.hdr")).toHaveAttribute("data-kind", "asset");
  // The star keeps a folder in the favourites; the search finds the scene and Enter opens it.
  await entry("New folder/studio_small_09_1k.hdr").getByTestId("project-star").click();
  await expect(window.getByTestId("project-favourite")).toHaveCount(1);
  await window.locator('[data-testid="project-folder"][data-path=""]').click();
  await window.getByTestId("project-search").fill("main.scene");
  await expect(entry("scenes/main.scene.json")).toHaveAttribute("data-kind", "scene");
});
