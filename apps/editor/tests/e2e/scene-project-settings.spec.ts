// SPDX-License-Identifier: Apache-2.0
// The Project settings window: no field of the project file needs a text editor. The spec copies the walkthrough
// sample into a temp folder and starts the dev server of the scene page on it. The form edits a text, a list, a map
// entry, a flag and a union, and Save writes canonical JSON. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-project-settings --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { canonicalJson } from "@scenity/scene";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-project-settings-"));
  for (const part of ["assets", "rights", "scenes", "sequences", "scenity.project.json"])
    cpSync(join(WALKTHROUGH, part), join(dir, part), { recursive: true });
  server = await startSpecServer({ walk: dir });
  origin = server.origin;
  key = server.keys.walk ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

type ProjectFile = Record<string, unknown> & {
  plugins?: string[];
  build: { budgets: Record<string, { gzipKB: number }> };
  release: { rights?: { review?: boolean } };
  rules: unknown[];
};
const projectFile = (): ProjectFile =>
  JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as ProjectFile;

async function open(page: Page) {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/plaza.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.projectSettings"));
  const panel = page.getByTestId("project-settings");
  await expect(panel).toHaveAttribute("data-loaded", "1", READY);
  return panel;
}

test("each field of the project file changes in the form and Save writes canonical JSON", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const panel = await open(page);
  // General: a text and a list.
  await panel.getByTestId("project-input-name").fill("Walk two");
  await panel.getByTestId("project-input-name").press("Tab");
  await panel.getByTestId("project-add-item-scenes").click();
  await panel.getByTestId("project-input-scenes[1]").fill("scenes/none.scene.json");
  await panel.getByTestId("project-input-scenes[1]").press("Tab");
  // A bad ID shows its check at once and Save waits for a good value.
  await panel.getByTestId("project-input-id").fill("Bad Id");
  await panel.getByTestId("project-input-id").press("Tab");
  await expect(panel.getByTestId("project-problem-id")).toBeVisible();
  await expect(panel.getByTestId("project-save")).toBeDisabled();
  await panel.getByTestId("project-input-id").fill("walk-two");
  await panel.getByTestId("project-input-id").press("Tab");
  await expect(panel.getByTestId("project-problem-id")).toHaveCount(0);
  // Build: a new entry of the size budgets (a map).
  await panel.getByTestId("project-section-build").click();
  await panel.getByTestId("project-new-key-build.budgets").fill("extra");
  await panel.getByTestId("project-add-entry-build.budgets").click();
  await panel.getByTestId("project-input-build.budgets.extra.gzipKB").fill("12");
  await panel.getByTestId("project-input-build.budgets.extra.gzipKB").press("Tab");
  // Release: an absent object and a flag in it.
  await panel.getByTestId("project-section-release").click();
  await panel.getByTestId("project-add-release.rights").click();
  await panel.getByTestId("project-add-release.rights.review").click();
  await panel.getByTestId("project-input-release.rights.review").check();
  // Rules: a rules file as a new item (the text option of the union).
  await panel.getByTestId("project-section-rules").click();
  await panel.getByTestId("project-add-item-rules").click();
  await panel.locator('[data-path="rules[1]"] select').first().selectOption({ label: "text" });
  await panel.getByTestId("project-input-rules[1]").fill("rules/more.rules.json");
  await panel.getByTestId("project-input-rules[1]").press("Tab");
  await expect(panel).toHaveAttribute("data-dirty", "1");
  await panel.getByTestId("project-save").click();
  await expect(panel).toHaveAttribute("data-dirty", "0");
  const text = readFileSync(join(dir, "scenity.project.json"), "utf8");
  const saved = projectFile();
  expect(text).toBe(canonicalJson(saved));
  expect(saved).toMatchObject({
    id: "walk-two",
    name: "Walk two",
    scenes: ["scenes/plaza.scene.json", "scenes/none.scene.json"],
  });
  expect(saved.build.budgets.extra).toEqual({ gzipKB: 12 });
  expect(saved.release.rights).toEqual({ review: true });
  expect(saved.rules[1]).toBe("rules/more.rules.json");
  // The server checks the files of the lists: the new scene is not in the project folder.
  await expect(panel.getByTestId("project-problems")).toContainText("scenes/none.scene.json");
  await panel.getByTestId("project-section-general").click();
  await expect(panel.getByTestId("project-problem-scenes[1]")).toContainText("scenes/none.scene.json");
});

test("the search shows the fields with the words, and Revert gives the saved value again", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const panel = await open(page);
  await panel.getByTestId("project-settings-search").fill("gzip");
  await expect(panel.getByTestId("project-input-build.budgets.player.gzipKB")).toBeVisible();
  await expect(panel.getByTestId("project-input-name")).toHaveCount(0);
  await panel.getByTestId("project-settings-search").fill("");
  await panel.getByTestId("project-input-name").fill("Changed");
  await panel.getByTestId("project-input-name").press("Tab");
  await expect(panel).toHaveAttribute("data-dirty", "1");
  await panel.getByTestId("project-revert").click();
  await expect(panel).toHaveAttribute("data-dirty", "0");
  await expect(panel.getByTestId("project-input-name")).toHaveValue("Walk two");
  // The Editor section has the project values of the editor settings.
  await panel.getByTestId("project-section-editor").click();
  await expect(
    panel.getByTestId("project-editor-fields").locator("[data-testid^='project-setting-']").first(),
  ).toBeVisible();
});

test("a run made in the form starts from the Jobs panel, with its log", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const panel = await open(page);
  await panel.getByTestId("project-section-workbench").click();
  await panel.getByTestId("project-new-key-workbench.runs").fill("hello");
  await panel.getByTestId("project-add-entry-workbench.runs").click();
  const command = `${process.execPath} -e "console.log('hello from the run')"`;
  await panel.getByTestId("project-input-workbench.runs.hello").fill(command);
  await panel.getByTestId("project-input-workbench.runs.hello").press("Tab");
  await panel.getByTestId("project-save").click();
  await expect(panel).toHaveAttribute("data-dirty", "0");
  expect((projectFile().workbench as { runs: Record<string, unknown> }).runs.hello).toBe(command);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.jobs"));
  const jobs = page.getByTestId("jobs");
  await jobs.getByTestId("jobs-refresh").click();
  await jobs.getByTestId("jobs-run-hello").click();
  const row = jobs.locator("[data-job]").first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await row.getByTestId("jobs-log").click();
  await expect(row.getByTestId("jobs-log-text")).toContainText("hello from the run");
  // Run again gives a second job of the run.
  await row.getByTestId("jobs-again").click();
  await expect(jobs.locator("[data-job]")).toHaveCount(2);
});

test("a person adds the physics plugin in the Plugins window with no text editor", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.plugins"));
  const panel = page.getByTestId("plugins");
  await expect(panel).toBeVisible(READY);
  const available = panel.getByTestId("plugins-available");
  await expect(available.locator("option", { hasText: "@scenity/physics-runtime" })).toHaveCount(1);
  await available.selectOption({ label: "@scenity/physics-runtime" });
  await panel.getByTestId("plugins-add-picked").click();
  await expect(panel.getByTestId("plugins-restart")).toBeVisible();
  const entry = projectFile().plugins?.at(-1) ?? "";
  expect(entry).toMatch(/plugins\/physics\/runtime$/);
  await expect(panel.getByTestId("plugin-@scenity/physics-runtime")).toContainText("Runtime");
  // After the reload the page has the components of the plugin: the inspector can add one.
  await Promise.all([page.waitForEvent("load"), panel.getByTestId("plugins-reload").click()]);
  // The new plugin brings new dependencies: the dev server optimizes them and loads the page again. Wait for the
  // dependency step, then take one clean load.
  await page.waitForTimeout(5000);
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["bench"]));
  await page.getByTestId("inspector-add").click();
  await expect(page.locator('[data-testid=inspector-add-item][data-component="physics.rigidBody"]')).toHaveCount(
    1,
    READY,
  );
});

test("the new plugin wizard makes a folder plugin; its component and its panel show after a reload", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.plugins"));
  const form = page.getByTestId("plugins-new");
  await expect(form).toBeVisible(READY);
  await form.getByTestId("plugins-new-id").fill("bounce");
  await form.getByTestId("plugins-new-component").fill("bob");
  await form.getByTestId("plugins-new-field-0").fill("height");
  await form.getByTestId("plugins-new-add-field").click();
  await form.getByTestId("plugins-new-field-1").fill("active");
  await form.getByTestId("plugins-new-kind-1").selectOption("boolean");
  await form.getByTestId("plugins-new-part-studio").check();
  await form.getByTestId("plugins-new-make").click();
  await expect(form.getByTestId("plugins-new-files")).toContainText("plugins/bounce/src/component.ts");
  expect(projectFile().plugins).toContain("./plugins/bounce");
  expect(existsSync(join(dir, "plugins/bounce/src/systems/bob.ts"))).toBe(true);
  // A reload loads the plugin. The dev server makes the module of the plugins again (and can optimize new
  // dependencies first), so the spec loads the page until the component is there, as a person presses Reload again.
  await expect
    .poll(
      async () => {
        await page.reload();
        await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
        await page.evaluate(() => globalThis.__scenity?.select?.(["bench"]));
        await page.getByTestId("inspector-add").click();
        const count = await page.locator('[data-testid=inspector-add-item][data-component="bounce.bob"]').count();
        await page.keyboard.press("Escape");
        return count;
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(1);
  // The studio face of the new plugin gives its panel.
  await expect
    .poll(async () => {
      await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.bounce.panel")).catch(() => null);
      return page.getByTestId("dock-tab-bounce.panel").count();
    }, READY)
    .toBeGreaterThan(0);
});

test("a command of the CLI face of a plugin runs from the search box as a job with its log", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  // A folder plugin with a CLI face only: the command `hello`.
  mkdirSync(join(dir, "plugins/greet"), { recursive: true });
  writeFileSync(
    join(dir, "plugins/greet/package.json"),
    JSON.stringify({ name: "@local/greet", private: true, type: "module", scenity: { cli: "cli.js" } }),
  );
  writeFileSync(
    join(dir, "plugins/greet/cli.js"),
    'export default { commands: [{ name: "hello", summary: "say hello", run: (argv) => { console.log(`hello ${argv.join(" ")}`); return 0; } }] };\n',
  );
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.plugins"));
  const plugins = page.getByTestId("plugins");
  await plugins.getByTestId("plugins-entry").fill("./plugins/greet");
  await plugins.getByTestId("plugins-add-entry").click();
  await expect(plugins.getByTestId("plugin-@local/greet")).toContainText("Commands");
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  // The command of the plugin is a command of the window with the argument `args` (the search box gives it a form).
  await expect
    .poll(() =>
      page
        .evaluate(() => globalThis.__scenity?.command?.("cli.hello", { args: "from the window" }))
        .then(
          () => true,
          () => false,
        ),
    )
    .toBe(true);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.jobs"));
  const jobs = page.getByTestId("jobs");
  await expect(jobs.getByTestId("jobs-commands")).toContainText("say hello");
  await jobs.getByTestId("jobs-refresh").click();
  const row = jobs.locator("[data-job]").filter({ hasText: "hello" }).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await row.getByTestId("jobs-log").click();
  await expect(row.getByTestId("jobs-log-text")).toContainText("hello from the window");
});
