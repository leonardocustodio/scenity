// SPDX-License-Identifier: Apache-2.0
// The walks in the Scene view on a copy of the walkthrough sample. The overlay draws the route of each walk of the
// selected actor. A move of an obstacle in the way changes the route in the view. `walk.add` adds a walk to a stand
// point as one step. The spec starts the dev server of the scene page on a temp folder, so the files of the repository
// never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-walks --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-walks-"));
  for (const part of ["assets", "build", "rights", "scenes", "sequences", "scenity.project.json"]) {
    if (existsSync(join(WALKTHROUGH, part))) cpSync(join(WALKTHROUGH, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ walks: dir });
  origin = server.origin;
  key = server.keys.walks ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=top&edit=1&scene=scenes/plaza.scene.json&t=0&paused=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-gizmo", "1", READY);
}

/** The routes of the walks of the selected actor. */
function routes(page: Page) {
  return page.evaluate(() => [...(globalThis.__scenity?.walkRoutes?.() ?? [])]);
}

test("the route of a walk changes in the view when an obstacle moves; walk.add adds a walk", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["ada"]));
  // Ada walks to meet-a around the planter: the route bends.
  await expect.poll(async () => (await routes(page)).length).toBe(1);
  const before = (await routes(page))[0]?.points ?? [];
  expect(before.length).toBeGreaterThan(2);
  await expect(page.getByTestId("scene-walks")).toHaveAttribute("data-routes", "1");
  // The planter moves away from the route: the route of the walk is then a straight line.
  const run = (id: string, args: Record<string, unknown>) =>
    page.evaluate(([command, given]) => globalThis.__scenity?.command?.(command, given), [id, args] as const);
  await run("entity.move", { entity: "planter", x: -2.6, y: 0.35, z: 6 });
  await expect.poll(async () => (await routes(page))[0]?.points.length).toBe(2);
  // A second walk to meet-b: one step of the history, and a second route from meet-a.
  await run("walk.add", { entity: "ada", to: "meet-b", t: 6000 });
  await expect.poll(async () => (await routes(page)).length).toBe(2);
  expect((await routes(page))[1]?.points[0]).toEqual((await routes(page))[0]?.points.at(-1));
  await expect(page.getByTestId("scene-walks")).toHaveAttribute("data-routes", "2");
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await routes(page)).length).toBe(1);
});

test("the character setup maps the bones of a rig and sets the bones of a robot", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.character"));
  const panel = page.getByTestId("character-panel");
  // The guide is the Rigify mannequin: its profile maps each required bone.
  await page.evaluate(() => globalThis.__scenity?.select?.(["guide"]));
  await expect(panel).toHaveAttribute("data-rig", "rigify");
  await expect(panel).toHaveAttribute("data-missing", "0", READY);
  await expect(panel.locator('[data-testid="character-bone"][data-bone="hips"]')).toHaveAttribute(
    "data-from",
    "profile",
  );
  await panel.getByTestId("character-detect").click();
  await expect(panel).toHaveAttribute("data-rig", "rigify");
  // Ada is a robot with no profile: its bone map is the bones of its character component.
  await page.evaluate(() => globalThis.__scenity?.select?.(["ada"]));
  await expect(panel).toHaveAttribute("data-entity", "ada");
  await expect(panel).toHaveAttribute("data-rig", "none");
  const head = panel.locator('[data-testid="character-bone"][data-bone="head"]');
  await expect(head).toHaveAttribute("data-from", "bones");
  await expect(head.getByTestId("character-node")).toHaveText("Head");
  await head.getByRole("combobox").click();
  await page.getByRole("option", { name: "Neck", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis.__scenity?.document().entities.ada?.components.character as { bones?: Record<string, string> })
            .bones?.head,
      ),
    )
    .toBe("Neck");
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect(head.getByTestId("character-node")).toHaveText("Head");
});
