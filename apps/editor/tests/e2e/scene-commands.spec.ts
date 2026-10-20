// SPDX-License-Identifier: Apache-2.0
// The creation, file and project commands on a copy of the showroom. A preset runs from the search box. Each file and
// project command runs as an agent tool (a run of Claude through the script API, as `scene_command` does). The files
// that the commands make are on the disk of the copy after the run.
// Run it alone:
//   bunx --bun playwright test scene-commands --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 150_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-commands-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ commands: dir });
  origin = server.origin;
  key = server.keys.commands ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode and wait for the frame and the panels. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  for (const mark of ["data-hierarchy", "data-inspector", "data-settings"])
    await expect(view).toHaveAttribute(mark, "1", READY);
}

/** Run a command of the window as Claude (the script API of `scene_command`). */
function asAgent(page: Page, id: string, args: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(([command, given]) => globalThis.__scenity?.command?.(command, given, { by: "claude" }), [
    id,
    args,
  ] as const);
}

test("a preset runs from the search box, and each file and project command runs as an agent tool", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const count = (): Promise<number> =>
    page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).length);
  const before = await count();
  // The search box: a preset of the Create menu.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("search-input").fill(">create a point light");
  await expect(page.getByTestId("search-row").first()).toHaveAttribute("data-item", "entity.create.pointLight");
  await page.keyboard.press("Enter");
  await expect.poll(count).toBe(before + 1);
  // The commands of the window list the presets and the file commands for the agents.
  const ids = await page.evaluate(() => (globalThis.__scenity?.commands?.() ?? []).map((item) => item.id));
  for (const id of [
    "entity.create.box",
    "scene.new",
    "scene.saveAs",
    "sequence.new",
    "prefab.create",
    "material.new",
    "project.set",
  ])
    expect(ids, id).toContain(id);
  // The file and project commands as agent tools.
  await asAgent(page, "project.set", { setting: "snaps.grid", value: "0.05" });
  await expect.poll(() => readText("scenity.editor.json")).toContain('"grid": 0.05');
  await asAgent(page, "prefab.create", { entity: "armchair", name: "Lounge chair" });
  const prefab = JSON.parse(readText("prefabs/lounge-chair.prefab.json")) as {
    root: string;
    entities: Record<string, unknown>;
  };
  expect(prefab.root).toBe("armchair");
  await asAgent(page, "material.new", { name: "Oak floor" });
  await expect.poll(() => existsSync(join(dir, "assets"))).toBe(true);
  await asAgent(page, "scene.new", { name: "Second room" });
  await expect.poll(() => readText("scenity.project.json")).toContain("second-room");
  // The new scene is the open scene now; an agent saves it.
  await asAgent(page, "scene.save", {});
  // Open the first scene again, save a copy of it, and close the copy.
  const path = (): Promise<string | undefined> => page.evaluate(() => globalThis.__scenity?.file().path);
  await asAgent(page, "scene.open", { path: "scenes/main.scene.json" });
  await expect.poll(path).toBe("scenes/main.scene.json");
  await asAgent(page, "scene.saveAs", { path: "scenes/main-copy.scene.json" });
  await expect.poll(() => existsSync(join(dir, "scenes/main-copy.scene.json"))).toBe(true);
  await expect.poll(path).toBe("scenes/main-copy.scene.json");
  await asAgent(page, "scene.close", {});
  await expect.poll(path).not.toBe("scenes/main-copy.scene.json");
  // A missing argument of an agent is not a question to the person: a bad value gives the reason.
  await expect(asAgent(page, "project.set", { setting: "snaps.grid", value: "x" })).rejects.toThrow("no JSON value");
  // The new sequence opens in the page.
  await asAgent(page, "sequence.new", { name: "Intro" });
  await expect(page).toHaveURL(/sequence=sequences%2Fintro\.sequence\.json/);
  expect(JSON.parse(readText("sequences/intro.sequence.json"))).toMatchObject({
    format: "scenity.sequence/1",
    id: "intro",
  });
});

test("the Create menu: a light, a camera from the view, a prefab that asks; one step and one agent command each", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const ids = (): Promise<string[]> =>
    page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}).sort());
  const create = async (command: string): Promise<void> => {
    await page.getByTestId("menu-entity").click();
    await page.getByRole("menuitem", { name: "Create", exact: true }).click();
    await page.locator(`[role=menuitem][data-command="${command}"]`).click();
  };
  const start = await ids();
  // A point light from Entity ▸ Create: one entity. One undo removes it (one step).
  await create("entity.create.pointLight");
  await expect.poll(async () => (await ids()).length).toBe(start.length + 1);
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(ids).toEqual(start);
  // A camera from the view: at the place of the view, with the direction of the view.
  const view = await page.evaluate(() => globalThis.__scenity?.viewport?.());
  await create("entity.create.cameraFromView");
  await expect.poll(async () => (await ids()).length).toBe(start.length + 1);
  const camera = await page.evaluate((list) => {
    const doc = globalThis.__scenity?.document();
    const id = Object.keys(doc?.entities ?? {}).find((each) => !list.includes(each)) ?? "";
    return doc?.entities[id]?.components as {
      camera?: unknown;
      transform?: { position: number[]; rotation?: number[] };
    };
  }, start);
  expect(camera.camera).toBeDefined();
  camera.transform?.position.forEach((value, at) => expect(value).toBeCloseTo(view?.position?.[at] ?? NaN, 2));
  expect(camera.transform?.rotation).toHaveLength(4);
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(ids).toEqual(start);
  // A prefab instance asks for its prefab.
  await create("entity.create.prefab");
  await page.getByTestId("command-prompt-input").fill("../prefabs/lounge.prefab.json");
  await page.getByTestId("command-prompt-go").click();
  await expect.poll(async () => (await ids()).length).toBe(start.length + 1);
  // Each preset is one agent command; a preset with an input refuses an agent run with no input.
  const agentStart = await ids();
  // Each run of the agent is one proposal; their accept adds the entities.
  const waiting = (): Promise<number> => page.evaluate(() => globalThis.__scenity?.proposals?.().length ?? -1);
  const proposed = await waiting();
  for (const preset of ["hemisphereLight", "audioSource", "obstacle", "spotLight", "standPoint"])
    await asAgent(page, `entity.create.${preset}`, {});
  await asAgent(page, "entity.create.character", { asset: "asset:01M4ZPXYG26FPR940EDPJM9FCD" });
  await expect.poll(waiting).toBe(proposed + 6);
  await page.evaluate(() => {
    const api = globalThis.__scenity;
    for (const proposal of api?.proposals?.() ?? []) api?.accept?.(proposal.id);
  });
  await expect.poll(async () => (await ids()).length).toBe(agentStart.length + 6);
  await expect(asAgent(page, "entity.create.prefab", {})).rejects.toThrow('needs "source"');
});

test("an agent puts 4 chairs around the table with the placement commands, and no box overlaps", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const agent = (id: string, args: Record<string, unknown>) =>
    page.evaluate(([command, given]) => globalThis.__scenity?.command?.(command, given, { by: "claude" }), [
      id,
      args,
    ] as const);
  // Three more armchairs: copies of the one of the showroom.
  await page.evaluate(async () => {
    const api = globalThis.__scenity;
    for (let copy = 0; copy < 3; copy += 1) {
      await api?.select?.(["armchair"]);
      await api?.command?.("entity.duplicate", {});
    }
  });
  const chairs = await page.evaluate(() =>
    Object.keys(globalThis.__scenity?.document().entities ?? {})
      .filter((id) => id.startsWith("armchair"))
      .sort(),
  );
  expect(chairs).toHaveLength(4);
  // The relation commands: each chair near a side of the table, turned to it.
  for (const [index, entity] of chairs.entries())
    await agent("place.near", { entity, target: "table", angle: index * 90, gap: 0.15, face: true });
  const report = () =>
    page.evaluate(
      async (ids) => {
        await globalThis.__scenity?.frame();
        const found = await globalThis.__scenity?.inspect?.();
        return Object.fromEntries(
          (found?.entities ?? [])
            .filter((item) => ids.includes(item.id) && item.bounds !== null)
            .map((item) => [item.id, item.bounds]),
        );
      },
      [...chairs, "table", "coffee-table", "ottoman", "shelf", "wall-back", "wall-left"],
    );
  // The core draws the last moves a frame or two later: wait until each chair is near the table in its report.
  const farthest = async (): Promise<number> => {
    const now = (await report()) as Record<string, { min: number[]; max: number[] } | null>;
    const mid = (id: string): [number, number] => {
      const b = now[id];
      return [((b?.min[0] ?? 0) + (b?.max[0] ?? 0)) / 2, ((b?.min[2] ?? 0) + (b?.max[2] ?? 0)) / 2];
    };
    const [tx, tz] = mid("table");
    return Math.max(...chairs.map((chair) => Math.hypot(mid(chair)[0] - tx, mid(chair)[1] - tz)));
  };
  await expect.poll(farthest, { timeout: 15_000 }).toBeLessThan(2.5);
  const boxes = await report();
  const ids = Object.keys(boxes);
  expect(ids).toEqual(expect.arrayContaining([...chairs, "table"]));
  // No two boxes go into each other by more than 1 cm.
  type Box = { min: number[]; max: number[] };
  const boxOf = (id: string): Box => {
    const found = (boxes as Record<string, Box | null | undefined>)[id];
    if (found === null || found === undefined) throw new Error(`no box of ${id}`);
    return found;
  };
  const depth = (a: Box, b: Box) =>
    Math.min(
      ...[0, 1, 2].map((at) => Math.min(a.max[at] ?? 0, b.max[at] ?? 0) - Math.max(a.min[at] ?? 0, b.min[at] ?? 0)),
    );
  const centre = (b: Box): [number, number] => [
    ((b.min[0] ?? 0) + (b.max[0] ?? 0)) / 2,
    ((b.min[2] ?? 0) + (b.max[2] ?? 0)) / 2,
  ];
  for (const chair of chairs)
    for (const other of ids)
      if (other !== chair) expect(depth(boxOf(chair), boxOf(other)), `${chair} into ${other}`).toBeLessThan(0.01);
  // Each chair stands around the table.
  const [tx, tz] = centre(boxOf("table"));
  for (const chair of chairs) {
    const [x, z] = centre(boxOf(chair));
    expect(Math.hypot(x - tx, z - tz)).toBeLessThan(2.5);
  }
});

/** A file of the copy as text ("" when it is not there). */
function readText(path: string): string {
  const file = join(dir, path);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
