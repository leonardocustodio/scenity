// SPDX-License-Identifier: Apache-2.0
// The UI speed budgets: the first paint of the Hub, the ready time of the editor (the showroom, warm), the scroll of a
// hierarchy of 10,000 entities, a click that selects in one frame, an inspector of 50 components, and the delay of a
// key in the search box. The spec starts the dev server of the scene page on a copy of the showroom with a scene of
// 10,000 entities and a plugin of 50 components. It writes the values to `test-results/speed.json`.
// SCENITY_SPEED_SCALE scales the budgets for a machine that is slower than the reference machine. The reference
// machine is an Apple silicon laptop with a GPU. Elsewhere, the software renderer of the browser is slower.
// Run it alone under the GPU lock:
//   bunx --bun playwright test studio-speed --project=chromium --workers=1
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 120_000 };
const SCALE = Number(process.env.SCENITY_SPEED_SCALE ?? "1") || 1;
/** The budgets in ms. */
const BUDGETS = {
  hubFirstPaint: 1000,
  editorReady: 3000,
  hierarchyFrame: 1000 / 60 + 4,
  hierarchySelectFrames: 1,
  inspector50: 500,
  keyDelay: 50,
} as const;
const values: Record<string, number> = {};

test.describe.configure({ mode: "serial", timeout: 240_000 });
// The budgets are for a GPU. On macOS, the new headless mode of Chromium has the Metal adapter (as in the bench).
test.use(process.platform === "darwin" ? { channel: "chromium" } : {});

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/** A scene of 10,000 entities: 100 groups of 99 entities, and a front camera. */
function bigScene(): object {
  const entities: Record<string, object> = {
    front: {
      name: "Front camera",
      parent: null,
      index: 0,
      components: { transform: { position: [0, 2, 8] }, camera: { fov: 50 } },
    },
  };
  for (let group = 0; group < 100; group += 1) {
    entities[`g${String(group)}`] = { name: `Group ${String(group)}`, parent: null, index: group + 1, components: {} };
    for (let item = 0; item < 99; item += 1)
      entities[`g${String(group)}-${String(item)}`] = {
        name: `Item ${String(group)}.${String(item)}`,
        parent: `g${String(group)}`,
        index: item,
        components: {},
      };
  }
  return { format: "scenity.scene/1", id: "big", entities };
}

/** The runtime face of a plugin of 50 components (`many.part0` to `many.part49`). */
const MANY_RUNTIME = `import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";

const components = Array.from({ length: 50 }, (_, index) =>
  defineComponent({
    id: \`many.part\${String(index)}\`,
    schema: z.strictObject({ value: z.number().optional(), label: z.string().optional() }),
    defaults: { value: 0 },
    editor: {
      label: \`Part \${String(index)}\`,
      group: "Many",
      fields: { value: { widget: { kind: "number" }, label: "Value" }, label: { widget: { kind: "text" }, label: "Label" } },
    },
  }),
);
export default defineRuntimePlugin({ id: "many", components });
`;

/** A scene with one entity that has the 50 components of the plugin. */
function manyScene(): object {
  const components: Record<string, object> = { transform: { position: [0, 0, 0] } };
  for (let index = 0; index < 50; index += 1) components[`many.part${String(index)}`] = { value: index };
  return {
    format: "scenity.scene/1",
    id: "many",
    entities: {
      front: {
        name: "Front camera",
        parent: null,
        index: 0,
        components: { transform: { position: [0, 2, 8] }, camera: { fov: 50 } },
      },
      many: { name: "Many", parent: null, index: 1, components },
    },
  };
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-speed-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  writeFileSync(join(dir, "scenes/big.scene.json"), `${JSON.stringify(bigScene())}\n`);
  writeFileSync(join(dir, "scenes/many.scene.json"), `${JSON.stringify(manyScene())}\n`);
  mkdirSync(join(dir, "plugins/many/src"), { recursive: true });
  writeFileSync(
    join(dir, "plugins/many/package.json"),
    JSON.stringify({ name: "@local/many", private: true, type: "module", scenity: { runtime: "src/runtime.ts" } }),
  );
  writeFileSync(join(dir, "plugins/many/src/runtime.ts"), MANY_RUNTIME);
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { plugins?: string[] };
  writeFileSync(
    join(dir, "scenity.project.json"),
    JSON.stringify({ ...project, plugins: [...(project.plugins ?? []), "./plugins/many"] }),
  );
  server = await startSpecServer({ speed: dir });
  origin = server.origin;
  key = server.keys.speed ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  const report = join(LABS_ROOT, "test-results/speed.json");
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, `${JSON.stringify({ scale: SCALE, budgets: BUDGETS, values }, null, 2)}\n`);
  console.log(`[speed] ${JSON.stringify(values)}`);
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

const editor = (scene: string) =>
  `${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/${scene}.scene.json`;

async function open(page: Page, scene: string): Promise<void> {
  await page.goto(editor(scene));
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

test("the Hub paints in under a second", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/hub.html`);
  // Warm: the second load, as a person who opens the studio again.
  await page.reload();
  const paint = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const known = performance.getEntriesByName("first-contentful-paint")[0];
        if (known !== undefined) done(known.startTime);
        else
          new PerformanceObserver((list) => {
            const entry = list.getEntriesByName("first-contentful-paint")[0];
            if (entry !== undefined) done(entry.startTime);
          }).observe({ type: "paint", buffered: true });
      }),
  );
  values.hubFirstPaint = Math.round(paint);
  expect(paint).toBeLessThan(BUDGETS.hubFirstPaint * SCALE);
});

test("the editor of the showroom is ready in under 3 seconds, warm", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "main");
  // The median of three warm loads: one load varies with the other work of the machine.
  const times: number[] = [];
  for (let load = 0; load < 3; load += 1) {
    const start = Date.now();
    await open(page, "main");
    times.push(Date.now() - start);
  }
  values.editorReady = times.sort((a, b) => a - b)[1] ?? Infinity;
  expect(values.editorReady).toBeLessThan(BUDGETS.editorReady * SCALE);
});

test("10,000 entities scroll at 60 fps and a click selects in one frame", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "big");
  const tree = page.getByTestId("hierarchy-tree");
  await expect(tree).toHaveAttribute("data-rows", "10001", READY);
  const frames = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>('[data-testid="hierarchy-tree"]');
    if (element === null) return [];
    const times: number[] = [];
    let last = performance.now();
    for (let step = 0; step < 120; step += 1) {
      element.scrollTop += 700;
      element.dispatchEvent(new Event("scroll"));
      await new Promise((done) => requestAnimationFrame(done));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    return times.sort((a, b) => a - b);
  });
  const median = frames[Math.floor(frames.length / 2)] ?? Infinity;
  values.hierarchyFrame = Math.round(median * 10) / 10;
  expect(median).toBeLessThan(BUDGETS.hierarchyFrame * SCALE);
  // A click on a row: the row is selected at the next frame.
  const frameCount = await page.evaluate(async () => {
    const row = document.querySelector<HTMLElement>('[role="treeitem"]:not([aria-selected="true"])');
    if (row === null) return Infinity;
    row.click();
    for (let count = 1; count <= 10; count += 1) {
      await new Promise((done) => requestAnimationFrame(done));
      if (row.getAttribute("aria-selected") === "true") return count;
    }
    return Infinity;
  });
  values.hierarchySelectFrames = frameCount;
  expect(frameCount).toBeLessThanOrEqual(BUDGETS.hierarchySelectFrames * Math.ceil(SCALE));
});

test("an inspector of 50 components shows in under half a second", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "many");
  await expect(page.locator('[data-testid="hierarchy-row-many"]')).toBeVisible(READY);
  const ms = await page.evaluate(async () => {
    const start = performance.now();
    await globalThis.__scenity?.select?.(["many"]);
    for (;;) {
      await new Promise((done) => requestAnimationFrame(done));
      const cards = document.querySelectorAll('[data-testid^="inspector-component-many.part"]').length;
      if (cards === 50) return performance.now() - start;
      if (performance.now() - start > 10_000) return Infinity;
    }
  });
  values.inspector50 = Math.round(ms);
  expect(ms).toBeLessThan(BUDGETS.inspector50 * SCALE);
});

test("a key in the search box shows its results in under 50 ms", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "main");
  await page.keyboard.press("ControlOrMeta+K");
  const input = page.getByTestId("search-input");
  await expect(input).toBeVisible();
  const delays = await page.evaluate(async () => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
    if (field === null) return [];
    const times: number[] = [];
    for (const key of "armchair") {
      const start = performance.now();
      field.value += key;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((done) => requestAnimationFrame(done));
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b);
  });
  const median = delays[Math.floor(delays.length / 2)] ?? Infinity;
  values.keyDelay = Math.round(median * 10) / 10;
  expect(median).toBeLessThan(BUDGETS.keyDelay * SCALE);
  await expect(page.getByTestId("search-row").first()).toBeVisible();
});
