// SPDX-License-Identifier: Apache-2.0
// The rules panel and the metric graph of the scene page, a tab of the bottom dock in the edit mode. The spec uses a
// copy of the showroom in a temp folder. The panel lists the rules of the scene and the project, grouped by file. A
// move of the lantern off the table makes `showroom.lanternOnTable` fail after the debounced check. A click on the row
// selects its entities. Then the spec uses the pickup sequence of the characters sample (no save). A click on
// `pickup.gripAtPickup` seeks to its marker and shows its value over the sequence time with the marker. Run it alone
// under the GPU lock:
//   bunx --bun playwright test scene-rules-panel --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SIM_ROAD = join(LABS_ROOT, "../../samples/sim-road");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
/** A copy of sim-road in the checkout (`.scenity/tmp`), so its plugin package resolves from the copy. */
let road = "";
let origin = "";
let server: SpecServer | null = null;

/** The key of a project of the spec in the page URLs. */
const key = (name: string): string => server?.keys[name] ?? name;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-rules-panel-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  mkdirSync(join(LABS_ROOT, "../../.scenity/tmp"), { recursive: true });
  road = mkdtempSync(join(LABS_ROOT, "../../.scenity/tmp/rules-road-"));
  for (const part of ["assets", "build", "rights", "scenes", "sequences", "scenity.project.json"]) {
    cpSync(join(SIM_ROAD, part), join(road, part), { recursive: true });
  }
  server = await startSpecServer({ panel: dir, road });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  if (road !== "") rmSync(road, { recursive: true, force: true });
});

/** Open the rules tab of the dock and wait for its first check. */
async function openRules(page: Page): Promise<void> {
  await page.getByTestId("dock-tab-rules").click();
  const panel = page.getByTestId("scene-rules");
  await expect(panel).toBeVisible();
  await expect.poll(async () => Number(await panel.getAttribute("data-checks")), READY).toBeGreaterThan(0);
}

/** The result of a rule row. */
function status(page: Page, id: string) {
  return page.locator(`[data-testid="rules-check"][data-rule="${id}"]`);
}

test("the panel lists the showroom rules; a move of the lantern off the table fails lanternOnTable", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("panel")}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  const groups = page.getByTestId("rules-group");
  await expect(groups).toHaveCount(2);
  expect(await groups.evaluateAll((items) => items.map((item) => item.getAttribute("data-source")))).toEqual([
    "scenes/main.scene.json",
    "scenity.project.json",
  ]);
  for (const id of ["showroom.lanternOnTable", "showroom.triangles", "showroom.ottomanClear", "showroom.onFloor"]) {
    await expect(status(page, id)).toHaveCount(1);
  }
  await expect(status(page, "showroom.lanternOnTable")).toHaveAttribute("data-status", "pass");
  // Move the lantern off the table, to the middle of the room: the panel checks again after the edit.
  const path = "/entities/lantern/components/transform/position";
  expect(
    await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [-1.6, 0.05, 1.2] }]), path),
  ).toBeNull();
  await expect(status(page, "showroom.lanternOnTable")).toHaveAttribute("data-status", "fail", READY);
  await expect(status(page, "showroom.lanternOnTable")).toContainText("max 0.45 m");
  // The filter keeps the failed rules only.
  await page.getByTestId("rules-filter-failed").check();
  await expect(page.getByTestId("rules-check")).toHaveCount(1);
  // A click on the row selects the entities of the rule.
  await status(page, "showroom.lanternOnTable").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.() ?? [])).toEqual(["table", "lantern"]);
  await expect(status(page, "showroom.lanternOnTable")).toHaveAttribute("data-selected", "1");
});

test("the pickup sequence: a click on gripAtPickup seeks to its marker and shows its graph", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const scene = "scenes/pickup.scene.json";
  const sequence = "sequences/pickup.sequence.json";
  await page.goto(`${origin}/scene.html?project=characters&scene=${scene}&sequence=${sequence}&paused=1&edit=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  const row = status(page, "pickup.gripAtPickup");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("marker pickup");
  await expect(row).toContainText("(provisional)");
  await row.click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.time?.())).toBe(5000);
  const graph = page.getByTestId("rule-graph");
  await expect(graph.getByTestId("rule-graph-id")).toHaveText("pickup.gripAtPickup", READY);
  await expect(graph.locator('[data-testid="rule-graph-marker"][data-marker="pickup"]')).toHaveCount(1);
  await expect(graph.getByTestId("rule-graph-check")).toHaveCount(1);
  await expect(graph.getByTestId("rule-graph-limit")).toHaveCount(1);
  expect(Number(await graph.locator("svg").getAttribute("data-points"))).toBeGreaterThan(10);
});

test("from the Problems panel: a rule fails, Go to selects it, a fix clears it, the save passes", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("panel")}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const path = "/entities/lantern/components/transform/position";
  const start = await page.evaluate(
    () => (globalThis.__scenity?.document().entities.lantern?.components.transform as { position?: number[] }).position,
  );
  // Move the lantern off the table: the rule fails and the Problems panel shows it.
  await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [-1.6, 0.05, 1.2] }]), path);
  await page.keyboard.press("ControlOrMeta+Shift+M");
  const panel = page.getByTestId("problems-panel");
  const row = panel.getByTestId("problem-row").filter({ hasText: "showroom.lanternOnTable" });
  await expect(row).toHaveCount(1, READY);
  await expect(page.getByTestId("status-problems")).toHaveAttribute("data-state", /fail|warn/);
  // Go to selects the entities of the rule.
  await row.getByTestId("problem-go").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.() ?? [])).toEqual(["table", "lantern"]);
  // The fix: the lantern returns to the table. The problem goes, and the save passes the gate.
  await page.evaluate(([at, value]) => globalThis.__scenity?.apply([{ op: "set", path: at, value }]), [
    path,
    start,
  ] as const);
  await expect(row).toHaveCount(0, READY);
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved", READY);
});

test("a rule with no text editor: a scene rule, an edit, a new rules file", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("panel")}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  // A new rule of the scene: the lantern is near the table (the metric picker and its argument fields).
  await page.getByTestId("rules-new").click();
  const form = page.getByTestId("rule-editor");
  await form.getByTestId("rule-id").fill("lanternNearTable");
  await form.getByTestId("rule-metric").selectOption("distance");
  await form.getByTestId("rule-arg-from").fill("entity:lantern");
  await form.getByTestId("rule-arg-to").fill("entity:table");
  await form.getByTestId("rule-max").fill("2");
  await form.getByTestId("rule-note").fill("The lantern stays on the table.");
  await form.getByTestId("rule-save").click();
  await expect(form).toHaveCount(0);
  await expect(status(page, "lanternNearTable")).toHaveAttribute("data-status", "pass", READY);
  const rules = () => page.evaluate(() => globalThis.__scenity?.document().rules ?? []);
  expect((await rules()).find((rule) => rule.id === "lanternNearTable")).toMatchObject({
    metric: "distance",
    args: { from: "entity:lantern", to: "entity:table" },
    max: 2,
    level: "warn",
  });
  // Edit it: a limit that the scene does not meet makes the rule fail.
  await status(page, "lanternNearTable").click();
  await page.getByTestId("rules-edit").click();
  await expect(form.getByTestId("rule-max")).toHaveValue("2");
  await form.getByTestId("rule-max").fill("0.01");
  await form.getByTestId("rule-level").selectOption("block");
  await form.getByTestId("rule-save").click();
  await expect(status(page, "lanternNearTable")).toHaveAttribute("data-status", "fail", READY);
  // A new rules file of the project: the file is written, and the project names it.
  await page.getByTestId("rules-new").click();
  await form.getByTestId("rule-target").selectOption("*new");
  await form.getByTestId("rule-new-file").fill("rules/layout.rules.json");
  await form.getByTestId("rule-id").fill("layout.tableOnFloor");
  await form.getByTestId("rule-metric").selectOption("belowFloor");
  await form.getByTestId("rule-arg-entity").fill("table");
  await form.getByTestId("rule-max").fill("0");
  await form.getByTestId("rule-save").click();
  await expect(status(page, "layout.tableOnFloor")).toHaveCount(1, READY);
  const file = join(dir, "rules/layout.rules.json");
  expect(existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
    format: "scenity.rules/1",
    rules: [{ id: "layout.tableOnFloor" }],
  });
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { rules: unknown[] };
  expect(project.rules).toContain("rules/layout.rules.json");
  // Remove the scene rule: the scene has its own rules again.
  await status(page, "lanternNearTable").click();
  await page.getByTestId("rules-edit").click();
  await form.getByTestId("rule-remove").click();
  await expect(status(page, "lanternNearTable")).toHaveCount(0, READY);
});

test("the rules log shows each override with its reason and its scene hash", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("panel")}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  const log = page.getByTestId("rules-log");
  await expect(log.getByTestId("rules-log-entry")).toHaveCount(0);
  // The lantern off the table fails a block rule: the save asks for a reason, and the gate logs the override.
  const path = "/entities/lantern/components/transform/position";
  await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [-1.6, 0.05, 1.2] }]), path);
  await expect(status(page, "showroom.lanternOnTable")).toHaveAttribute("data-status", "fail", READY);
  await page.getByTestId("scene-save").click();
  await page.getByTestId("rules-reason").fill("The lantern stands on the floor for the photo.");
  await page.getByTestId("rules-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved", READY);
  const entry = log.getByTestId("rules-log-entry");
  await expect(entry).toHaveCount(1, READY);
  await expect(entry.getByTestId("rules-log-reason")).toHaveText("The lantern stands on the floor for the photo.");
  await expect(entry).toContainText("showroom.lanternOnTable");
  await expect(entry).toHaveAttribute("data-current", "1");
  const line = JSON.parse(readFileSync(join(dir, "scenes/main.rules-log.jsonl"), "utf8").trim()) as { hash: string };
  await expect(entry.getByTestId("rules-log-hash")).toHaveText(line.hash.slice(0, 12));
  await expect(entry.getByTestId("rules-log-hash")).toHaveAttribute("title", line.hash);
});

test("the check job: scenity check from the Problems panel gives the table of the page check", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("panel")}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  await page.keyboard.press("ControlOrMeta+Shift+M");
  const problems = page.getByTestId("problems-panel");
  await problems.getByTestId("problems-check").click();
  await expect(problems.getByTestId("problems-check")).toBeEnabled({ timeout: 120_000 });
  // The lantern stands off the table since the override of the test before: the check fails it, as the page does.
  await expect(
    problems.getByTestId("problem-row").filter({ hasText: "scenity check: showroom.lanternOnTable" }),
  ).toHaveCount(1, READY);
  await page.getByTestId("dock-tab-rules").click();
  const compare = page.getByTestId("rules-cli-compare");
  await expect(compare).toHaveAttribute("data-same", "1", READY);
  await expect(compare).toContainText("the same results");
});

test("a sample rule with a plugin metric shows its value and passes the save gate", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key("road")}&camera=front&edit=1&scene=scenes/road.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await openRules(page);
  // road.carGap is a block rule of the project on `traffic.vehicleGap`, a metric of the dev face of the traffic plugin.
  await expect(status(page, "road.carGap")).toHaveAttribute("data-status", "pass", READY);
  await expect(page.locator('[data-rule="road.carGap"]').first()).toContainText("8");
  // The picker of the rules editor offers the metric of the plugin.
  await page.getByTestId("rules-new").click();
  await expect(page.getByTestId("rule-metric").locator('option[value="traffic.vehicleGap"]')).toHaveCount(1, READY);
  await page.getByTestId("rule-cancel").click();
  // An edit and a save: the gate passes the rule (an unknown metric would stop a block rule).
  const path = "/entities/tree-1/components/transform/position";
  const at = await page.evaluate(
    () =>
      (globalThis.__scenity?.document().entities["tree-1"]?.components.transform as { position: number[] }).position,
  );
  await page.evaluate(([p, v]) => globalThis.__scenity?.apply([{ op: "set", path: p, value: v }]), [
    path,
    [at[0] ?? 0, at[1] ?? 0, (at[2] ?? 0) + 0.5],
  ] as [string, number[]]);
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved", READY);
});
