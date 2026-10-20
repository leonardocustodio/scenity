// SPDX-License-Identifier: Apache-2.0
// The asset build panel and the asset sources. `assets build` runs from the panel, and a stale asset has a mark. A
// Poly Haven sky imports with its rights record in 3 clicks. The spec makes a small project in a temp folder (the
// rights and the settings of the showroom, one empty scene). It imports a PNG that it makes (CC0), so the build takes
// seconds. A local server of the spec answers as the API, the CDN and the downloads of Poly Haven (the sky is the CC0
// HDRI of the showroom). Run it alone under the GPU lock:
//   bunx --bun playwright test scene-asset-build --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { encode } from "fast-png";
import { projectPicture } from "../../../../packages/studio-host/src/registry";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
/** The box model of the import fixtures of `@scenity/assets` (made by the project, CC0). */
const BOX = join(LABS_ROOT, "../../packages/assets/tests/fixtures/import");
const READY = { timeout: 60_000 };
const BUILD = { timeout: 120_000 };

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";
let polyHaven: ReturnType<typeof Bun.serve> | null = null;

/** The fake Poly Haven: the list of the HDRIs, the files of one sky, its preview and its file. */
function fakePolyHaven(): ReturnType<typeof Bun.serve> {
  const sky = new Uint8Array(readFileSync(join(SHOWROOM, "assets/sources/studio_small_09_1k.hdr")));
  const preview = new Uint8Array(png(90));
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      if (url.pathname === "/api/assets" && url.searchParams.get("t") === "hdris") {
        return Response.json({ studio_small_09: { name: "Studio Small 09", tags: ["studio"], download_count: 5 } });
      }
      if (url.pathname === "/api/files/studio_small_09") {
        return Response.json({
          hdri: { "1k": { hdr: { url: `${origin}/dl/studio_small_09_1k.hdr`, size: sky.byteLength } } },
        });
      }
      if (url.pathname === "/cdn/asset_img/thumbs/studio_small_09.png") {
        return new Response(preview, { headers: { "Content-Type": "image/png" } });
      }
      if (url.pathname === "/dl/studio_small_09_1k.hdr") return new Response(sky);
      // A generation service: the cost, then the files of a model (the box of the import fixtures).
      if (url.pathname === "/gen/estimate") return Response.json({ cost: 2, unit: "credits", seconds: 90 });
      if (url.pathname === "/gen/generate") {
        const files = ["box.gltf", "box.bin", "box_color.png"].map((path) => ({ path, url: `${origin}/box/${path}` }));
        return Response.json({ name: "Red Crate", files });
      }
      if (url.pathname.startsWith("/box/")) {
        return new Response(new Uint8Array(readFileSync(join(BOX, url.pathname.slice("/box/".length)))));
      }
      return new Response("not found", { status: 404 });
    },
  });
}

/** The project: the settings and the rights of the showroom, an empty asset folder and one scene with a floor. */
function makeProject(): string {
  const folder = mkdtempSync(join(tmpdir(), "scenity-asset-build-"));
  const project = JSON.parse(readFileSync(join(SHOWROOM, "scenity.project.json"), "utf8")) as Record<string, unknown>;
  delete project.rules;
  project.scenes = ["scenes/main.scene.json"];
  writeFileSync(join(folder, "scenity.project.json"), JSON.stringify(project, null, 2));
  cpSync(join(SHOWROOM, "rights"), join(folder, "rights"), { recursive: true });
  mkdirSync(join(folder, "assets"));
  mkdirSync(join(folder, "scenes"));
  const shape = { kind: "plane", size: [6, 0, 6], colour: "#b9a98f" };
  const floor = { name: "Floor", parent: null, index: 0, tags: [], components: { shape } };
  const scene = { format: "scenity.scene/1", id: "main", name: "Main", entities: { floor } };
  writeFileSync(join(folder, "scenes/main.scene.json"), JSON.stringify(scene, null, 2));
  return folder;
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = makeProject();
  polyHaven = fakePolyHaven();
  const fake = `http://127.0.0.1:${String(polyHaven.port)}`;
  server = await startSpecServer(
    { tiny: dir },
    {
      SCENITY_POLYHAVEN_API: `${fake}/api`,
      SCENITY_POLYHAVEN_CDN: `${fake}/cdn`,
      SCENITY_GENERATOR_URL: `${fake}/gen`,
      SCENITY_GENERATOR_NAME: "Acme 3D",
      // The bench runs of the panel take a lock of their own (this spec holds the lock of the tests).
      SCENITY_BENCH_LOCK: join(dir, ".scenity/bench.lock"),
    },
  );
  origin = server.origin;
  key = server.keys.tiny ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  void polyHaven?.stop(true);
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** A PNG of 8 by 8 pixels of one colour, made by the spec (CC0). */
function png(red: number): Buffer {
  const data = new Uint8Array(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) data.set([red, 120, 40, 255], index * 4);
  return Buffer.from(encode({ width: 8, height: 8, data, channels: 4 }));
}

test("the build runs from the panel; a changed record gives a stale mark", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", "0", READY);
  await page
    .getByTestId("asset-import-input")
    .setInputFiles({ name: "wall.png", mimeType: "image/png", buffer: png(200) });
  await page.getByTestId("asset-import-dialog").getByTestId("import-start").click();
  await expect(page.getByTestId("asset-browser")).toHaveAttribute("data-count", "1", READY);
  const { id } = JSON.parse(readFileSync(join(dir, "assets/sources/wall.png.meta.json"), "utf8")) as { id: string };

  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.assetBuild"));
  const panel = page.getByTestId("asset-build");
  const row = panel.getByTestId(`asset-build-row-${id}`);
  await expect(row).toHaveAttribute("data-state", "unbuilt", READY);
  // `assets build` runs from the panel: the log shows the CLI, and the asset is built.
  await panel.getByTestId("asset-build-run").click();
  await expect(panel.getByTestId("asset-build-result")).toHaveAttribute("data-code", "0", BUILD);
  await expect(panel.getByTestId("asset-build-log")).toContainText("build", READY);
  await expect(row).toHaveAttribute("data-state", "built");
  expect(JSON.parse(readFileSync(join(dir, "build/manifest.json"), "utf8"))).toMatchObject({
    records: [expect.objectContaining({ id }) as unknown],
  });
  // New build settings change the record: the asset is stale until the next build.
  await row.click();
  await panel.getByTestId("asset-build-codec-color").selectOption("uastc");
  await panel.getByTestId("asset-build-save").click();
  await expect(row).toHaveAttribute("data-state", "stale", READY);
  await expect(row.getByTestId("asset-build-mark")).toHaveText("Stale");
  const record = JSON.parse(readFileSync(join(dir, "assets/sources/wall.png.meta.json"), "utf8")) as {
    build?: unknown;
  };
  expect(record.build).toEqual({ codecs: { color: "uastc" } });
  await panel.getByTestId("asset-build-run").click();
  await expect(row).toHaveAttribute("data-state", "built", BUILD);
});

test("the bench runs from its panel; three runs show as a trend", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  test.setTimeout(480_000);
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.bench"));
  const panel = page.getByTestId("bench-panel");
  for (let run = 1; run <= 3; run += 1) {
    await panel.getByTestId("bench-run").click();
    await expect(panel).toHaveAttribute("data-runs", String(run), { timeout: 180_000 });
    await expect(panel.getByTestId("bench-result")).toHaveAttribute("data-code", /^[01]$/);
  }
  await expect(panel.getByTestId("bench-row").first()).toBeVisible();
  const trend = panel.locator('[data-testid="bench-trend"][data-key="workP95"]').first();
  await expect(trend).toHaveAttribute("data-points", "3");
  const lines = readFileSync(join(dir, ".scenity/bench/history.jsonl"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(3);
});

test("a build with no terminal: the Build window, its report, a budget and the built player", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  test.setTimeout(480_000);
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.build"));
  const panel = page.getByTestId("build-panel");
  await panel.getByTestId("build-run").click();
  await expect(panel.getByTestId("build-result")).toHaveAttribute("data-passed", "1", { timeout: 240_000 });
  await expect(panel.getByTestId("build-gate-clean")).toBeVisible();
  const player = panel.locator('[data-testid="build-entry"][data-entry="player"]');
  await expect(player).toContainText("Within the budget");
  // The built player opens from the panel: the page of the build answers.
  const href = await panel.getByTestId("build-open").getAttribute("href");
  const built = await page.request.get(new URL(href ?? "", origin).toString());
  expect(built.status()).toBe(200);
  expect(await built.text()).toContain("<scenity-player");
  // A budget under the size of the entry: the next build fails, and the entry is over its budget.
  await panel.getByTestId("build-budget-player").fill("1");
  await panel.getByTestId("build-save-budgets").click();
  const project = () =>
    (
      JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as {
        build: { budgets: Record<string, { gzipKB: number }> };
      }
    ).build.budgets;
  await expect.poll(() => project().player?.gzipKB).toBe(1);
  await panel.getByTestId("build-run").click();
  await expect(panel.getByTestId("build-result")).toHaveAttribute("data-passed", "0", { timeout: 240_000 });
  await expect(player).toContainText("Over the budget");
  // The budget of the project again, so the later tests build within it.
  await panel.getByTestId("build-budget-player").fill("63");
  await panel.getByTestId("build-save-budgets").click();
  await expect.poll(() => project().player?.gzipKB).toBe(63);
});

test("the embed snippet runs in a plain HTML file, and the preview plays the build", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.embed"));
  const panel = page.getByTestId("embed-panel");
  // The preview frame plays the build of the test before with the options of the panel.
  const preview = page.frameLocator('[data-testid="embed-frame"]').locator("scenity-player");
  await expect(preview).toHaveAttribute("data-state", "ready", READY);
  // A page in the build folder takes the snippet with the base "./": a plain HTML file, no editor code.
  await panel.getByTestId("embed-base").fill("./");
  await panel.getByTestId("embed-loop").check();
  const snippet = (await panel.getByTestId("embed-snippet").textContent()) ?? "";
  expect(snippet).toContain('<scenity-player src="./project/scenity.project.json" autoplay loop muted');
  writeFileSync(join(dir, "dist/embed-test.html"), `<!doctype html>\n<html><body>\n${snippet}\n</body></html>\n`);
  const plain = await page.context().newPage();
  await plain.goto(`${origin}/projects/${key}/dist/embed-test.html`);
  await expect(plain.locator("scenity-player")).toHaveAttribute("data-state", "ready", READY);
  await plain.close();
  // The other snippets: a script tag and the Vue component.
  await panel.getByTestId("embed-kind-script").click();
  await expect(panel.getByTestId("embed-snippet")).toContainText('document.createElement("scenity-player")');
  await panel.getByTestId("embed-kind-vue").click();
  await expect(panel.getByTestId("embed-snippet")).toContainText('import { ScenityPlayer } from "@scenity/player/vue"');
  await expect(panel.getByTestId("embed-snippet")).toContainText('project="./project/scenity.project.json"');
});

test("shots and baselines: verify shows the diff of a failed shot; a poster from a shot is the Hub picture", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  test.setTimeout(480_000);
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.baselines"));
  const panel = page.getByTestId("shots-panel");
  const shot = panel.locator('[data-testid="shots-shot"][data-file="test-results/shots/main--scene.png"]');
  await panel.getByTestId("shots-take").click();
  await expect(shot).toHaveCount(1, { timeout: 180_000 });
  // The owner confirms a new baseline: the first press asks, the second one writes it.
  await shot.getByTestId("shots-baseline").click();
  await expect(shot.getByTestId("shots-baseline")).toHaveText("Confirm: replace the baseline");
  await shot.getByTestId("shots-baseline").click();
  const baseline = join(dir, "baselines", process.platform, "main--scene.png");
  await expect.poll(() => existsSync(baseline)).toBe(true);
  // The shot as the poster of the scene: the Hub shows the first poster of the project.
  await shot.getByTestId("shots-poster").click();
  await expect(panel.getByTestId("shots-note")).toContainText("posters/main.png");
  expect(projectPicture(dir)).toBe("posters/main.png");
  expect(await page.evaluate(() => globalThis.__scenity?.document().poster)).toBe("../posters/main.png");
  // verify passes with the baseline of the build.
  await panel.getByTestId("shots-verify").click();
  await expect(panel.getByTestId("shots-verify-result")).toHaveAttribute("data-code", "0", { timeout: 240_000 });
  const item = panel.locator('[data-testid="shots-baseline-item"]').first();
  await expect(item).toHaveAttribute("data-result", "pass");
  // A baseline of another size: verify fails it and shows the actual picture over the baseline (the difference).
  await panel.getByTestId("shots-size").fill("640x400");
  await panel.getByTestId("shots-take").click();
  // The width of the PNG (its IHDR chunk): the new shot is in the file.
  const width = (): number => readFileSync(join(dir, "test-results/shots/main--scene.png")).readUInt32BE(16);
  await expect.poll(width, { timeout: 180_000 }).toBe(640);
  await shot.getByTestId("shots-baseline").click();
  await shot.getByTestId("shots-baseline").click();
  await panel.getByTestId("shots-verify").click();
  await expect(panel.getByTestId("shots-verify-result")).toHaveAttribute("data-code", "1", { timeout: 240_000 });
  await expect(item).toHaveAttribute("data-result", "fail");
  await expect(item.getByTestId("shots-diff")).toBeVisible();
});

test("a failed release check stops the publish and gives its reasons", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.build"));
  const panel = page.getByTestId("build-panel");
  // The texture of the first test has the open rights record of an import: the release gate stops it.
  await panel.getByTestId("publish-run").click();
  const result = panel.getByTestId("publish-result");
  await expect(result).toHaveAttribute("data-passed", "0", READY);
  await expect(result.getByTestId("publish-reasons").locator("li").first()).toContainText("rights");
  expect(existsSync(join(dir, "test-results/publish/showroom.zip"))).toBe(false);
  // A rights record that the project accepts: the publish writes the archive of the build.
  const recordPath = join(dir, "assets/sources/wall.png.meta.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
  writeFileSync(recordPath, JSON.stringify({ ...record, rights: "../../rights/polyhaven.yaml" }));
  await panel.getByTestId("publish-run").click();
  await expect(result).toHaveAttribute("data-passed", "1", READY);
  const href = await result.getByTestId("publish-archive").getAttribute("href");
  const archive = await page.request.get(new URL(href ?? "", origin).toString());
  expect(archive.status()).toBe(200);
  // A ZIP archive starts with the signature of its first local file header.
  expect((await archive.body()).readUInt32LE(0)).toBe(0x04034b50);
});

test("a Poly Haven sky imports with its rights record in 3 clicks", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const browser = page.getByTestId("asset-browser");
  const before = Number(await browser.getAttribute("data-count"));
  // 1: Get assets (the skies of Poly Haven show), 2: the sky, 3: Import.
  await page.getByTestId("asset-get").click();
  const item = page.getByTestId("sources-item-studio_small_09");
  await item.click();
  await expect
    .poll(() => item.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth), READY)
    .toBeGreaterThan(0);
  await page.getByTestId("sources-import").click();
  await expect(browser).toHaveAttribute("data-count", String(before + 1), READY);
  await expect(page.getByTestId("asset-sources")).toHaveCount(0);
  const recordPath = join(dir, "assets/sources/polyhaven/studio_small_09/studio_small_09_1k.hdr.meta.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as { id: string; kind: string; rights: string };
  expect(record).toMatchObject({ kind: "environment", rights: "../../../../rights/polyhaven.yaml" });
  expect(readFileSync(join(dir, "rights/polyhaven.yaml"), "utf8")).toContain("CC0");
  await expect(page.getByTestId(`asset-tile-${record.id}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("asset-status")).toContainText("rights/polyhaven.yaml");
});

test("a generated model shows its cost first, then imports with its record", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const browser = page.getByTestId("asset-browser");
  await expect(browser).not.toHaveAttribute("data-count", "-1", READY);
  const before = Number(await browser.getAttribute("data-count"));
  await page.getByTestId("asset-get").click();
  await page.getByTestId("sources-generate").click();
  const form = page.getByTestId("generate-form");
  await form.getByTestId("generate-prompt").fill("a red wooden crate");
  await expect(form.getByTestId("generate-run")).toBeDisabled();
  await form.getByTestId("generate-estimate").click();
  await expect(form.getByTestId("generate-cost")).toContainText("2 credits", READY);
  await form.getByTestId("generate-run").click();
  await expect(browser).toHaveAttribute("data-count", String(before + 1), READY);
  const recordPath = join(dir, "assets/sources/generated/red-crate/box.gltf.meta.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as { kind: string; rights: string; tags: string[] };
  expect(record).toMatchObject({ kind: "model", rights: "../../../../rights/generated-service.yaml" });
  expect(record.tags).toEqual(["generated", "service"]);
  const rights = readFileSync(join(dir, "rights/generated-service.yaml"), "utf8");
  expect(rights).toContain("kind: generated");
  expect(rights).toContain('source: "Acme 3D"');
});

test("a budget change in the budgets editor shows in the next bench", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  test.setTimeout(300_000);
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.budgets"));
  const budgets = page.getByTestId("budgets");
  await expect(budgets.locator("[data-row='high.drawCalls']")).toBeVisible(READY);
  // A limit of one draw call at the tier high: the next bench is over it.
  await budgets.getByTestId("budgets-limit-high-drawCalls").fill("1");
  await budgets.getByTestId("budgets-limit-high-drawCalls").press("Tab");
  await budgets.getByTestId("budgets-save").click();
  await expect(budgets).toHaveAttribute("data-saved", "1");
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as {
    quality?: { budgets?: Record<string, Record<string, Record<string, number>>> };
  };
  expect(project.quality?.budgets?.scene?.high?.drawCalls).toBe(1);
  await budgets.getByTestId("budgets-bench").click();
  const bench = page.getByTestId("bench-panel");
  // The runs of the tests before show once the panel has its history.
  await expect(bench).toHaveAttribute("data-loaded", "1", READY);
  const runs = Number((await bench.getAttribute("data-runs")) ?? "0");
  await bench.getByTestId("bench-run").click();
  await expect(bench).toHaveAttribute("data-runs", String(runs + 1), { timeout: 180_000 });
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.budgets"));
  await budgets.getByTestId("budgets-refresh").click();
  // The next bench judged the draw calls with the new limit.
  const row = budgets.locator("[data-row='high.drawCalls']");
  await expect(row).toHaveAttribute("data-bench-limit", "1", READY);
  await expect(row).toHaveAttribute("data-result", /^(pass|over)$/);
});
