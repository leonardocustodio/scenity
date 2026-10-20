// SPDX-License-Identifier: Apache-2.0
// The first load of the edit mode through `scenity dev`. The spec copies the showroom to a temp folder with an empty
// sequence and no `scenity.editor.json`, and starts `scenity dev` on it: the dependency cache `<project>/.scenity/vite`
// is new. In the edit mode, it makes an edit and does not save it. Then it opens each dock tab, the hierarchy menu, the
// inspector, the camera preview, a layout tool and the play mode once. The page must not reload. Vite must not bundle
// a new module after the first load (scripts/scenityDeps.ts), and the unsaved edit stays with no draft prompt. The log
// of `scenity dev` shows no reload and no error of a lab module. The page gives no warning for the missing settings
// file. The camera preview names the camera entity. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-first-load --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const CLI = join(LABS_ROOT, "../../packages/cli/src/cli.ts");
const SEQUENCE = "sequences/first.sequence.json";
const EMPTY = { format: "scenity.sequence/1", id: "first", scene: "main", duration: 4000, tracks: [] };
const READY = { timeout: 90_000 };

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let url = "";
let log = "";
let server: ReturnType<typeof Bun.spawn> | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** Add each chunk of a stream of the server to the log. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) log += decoder.decode(chunk);
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-first-load-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  mkdirSync(join(dir, "sequences"));
  writeFileSync(join(dir, SEQUENCE), JSON.stringify(EMPTY));
  expect(existsSync(join(dir, ".scenity"))).toBe(false);
  expect(existsSync(join(dir, "scenity.editor.json"))).toBe(false);
  const port = await freePort();
  server = Bun.spawn(["bun", CLI, "dev", "--project", dir, "--port", String(port)], {
    cwd: dir,
    // No watch: an edit of the source by another tool must not reload the page during the test.
    env: { ...process.env, SCENITY_SCENE_NO_WATCH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  void collect(server.stdout as ReadableStream<Uint8Array>);
  void collect(server.stderr as ReadableStream<Uint8Array>);
  for (let wait = 0; wait < 240 && url === ""; wait += 1) {
    const line = log.split("\n").find((each) => each.startsWith("SCENITY_DEV_READY "));
    if (line !== undefined) url = (JSON.parse(line.slice("SCENITY_DEV_READY ".length)) as { url: string }).url;
    else await Bun.sleep(500);
  }
  if (url === "") throw new Error(`scenity dev did not start:\n${log}`);
});

test.afterAll(async () => {
  server?.kill();
  await server?.exited;
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Click a control and give the page a moment to load the chunks and the modules of the control. */
async function use(page: Page, testId: string, options: { button?: "right" } = {}): Promise<void> {
  await page.getByTestId(testId).click(options);
  await page.waitForTimeout(400);
}

test("the first use of each panel does not reload the page", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  let loads = 0;
  page.on("load", () => (loads += 1));
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") messages.push(message.text());
  });
  const settingsReads: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/scenity.editor.json")) settingsReads.push(response.status());
  });

  await page.goto(`${url}&camera=front&sequence=${SEQUENCE}&t=0&paused=1`);
  const view = page.getByTestId("scene-view");
  for (const flag of ["ready", "gizmo", "viewport", "settings", "hierarchy", "inspector", "layout-tools"]) {
    await expect(view).toHaveAttribute(`data-${flag}`, "1", READY);
  }
  await page.evaluate(() => {
    (globalThis as { firstLoadMark?: number }).firstLoadMark = 1;
  });
  // An edit that the page does not save: a reload would leave it only in the draft prompt.
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("entity.rename", { entity: "armchair", name: "Unsaved chair" }),
  );

  // The tab of each panel of the dock, then the Project panel again.
  const tabs = await page
    .locator('[data-testid^="dock-tab-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-testid") ?? ""));
  expect(tabs).toEqual(expect.arrayContaining(["dock-tab-timeline", "dock-tab-preferences", "dock-tab-material"]));
  for (const tab of tabs) await use(page, tab);
  await use(page, "dock-tab-project");
  await use(page, "dock-tab-inspector");
  await use(page, "dock-tab-hierarchy");
  await use(page, "dock-tab-scene.view");
  // The hierarchy menu, the inspector of an entity and its list of components.
  await use(page, "hierarchy-row-armchair", { button: "right" });
  await expect(page.getByTestId("hierarchy-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await use(page, "hierarchy-row-armchair");
  await expect(page.getByTestId("inspector-name")).toHaveValue("Unsaved chair");
  await page.getByTestId("inspector-add").focus();
  // The camera preview: its caption names the camera entity, not its ID.
  await page.evaluate(() => globalThis.__scenity?.select?.(["front"]));
  const preview = page.getByTestId("scene-camera-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("figcaption")).toContainText("Front camera");
  // A layout tool, then the play mode.
  await use(page, "layout-tool-measure");
  await use(page, "layout-tool-clear");
  await use(page, "play-start");
  await expect(page.getByTestId("play-stop")).toBeVisible();
  await use(page, "play-stop");
  await page.waitForTimeout(2000);

  expect(navigations).toBe(1);
  expect(loads).toBe(1);
  expect(await page.evaluate(() => (globalThis as { firstLoadMark?: number }).firstLoadMark)).toBe(1);
  const name = await page.evaluate(() => globalThis.__scenity?.document().entities.armchair?.name);
  expect(name).toBe("Unsaved chair");
  // The missing settings file reads as empty, with no warning and no failed request.
  expect(settingsReads).toEqual([204]);
  expect(messages.filter((text) => text.includes("does not read"))).toEqual([]);
  // The log of `scenity dev`: no new bundle after the first load, no reload and no lab module.
  expect(log).not.toContain("optimized dependencies changed");
  expect(log).not.toContain("Pre-transform error");
  expect(log).not.toContain("Internal server error");
  expect(log).not.toContain("labs-content-hash");
  await page.screenshot({ path: test.info().outputPath("first-load.png") });
});
