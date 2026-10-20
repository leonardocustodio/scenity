// SPDX-License-Identifier: Apache-2.0
// The post-processing effects on both backends. The scene `effects` of samples/showroom is the showroom with each
// effect value of the `environment` component enabled: ambient occlusion, bloom, SMAA and the selection outline. The
// test disables the effects with ops to draw one effect at a time, and selects the armchair for the outline. Each
// frame goes against its baseline: WebGL in the generic scene worker (project "scene", macOS and Linux) and WebGPU on
// the main thread (project "scene-webgpu", macOS). The project "scene-webgpu" also draws each frame with WebGL on the
// main thread of the same browser. The two pictures stay inside the backend tolerance of the effect. The project
// "scene" checks the tier caps. It also checks that a frame with no effect that draws is the frame of the scene with
// no effect value. On a machine with no WebGPU adapter, the WebGPU set skips.
import { writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import type { SceneOp } from "@scenity/scene";
import { ciWaitMs } from "../support/ci-timing";
import { diffFrames } from "../support/room3d-helpers";

/** The effects of a frame: the effect values that stay enabled, the selection, and the effects that the stats name. */
interface EffectFrame {
  readonly ao: boolean;
  readonly bloom: boolean;
  readonly antialias: "none" | "fxaa" | "smaa" | "msaa";
  readonly select: boolean;
  readonly effects: readonly string[];
}

const NONE = { ao: false, bloom: false, antialias: "none", select: false } as const;

/** The frames of the set: each effect alone, and all of them (the values of the document with a selection). */
const FRAMES = {
  all: { ao: true, bloom: true, antialias: "smaa", select: true, effects: ["ao", "bloom", "outline", "smaa"] },
  ao: { ...NONE, ao: true, effects: ["ao"] },
  bloom: { ...NONE, bloom: true, effects: ["bloom"] },
  outline: { ...NONE, select: true, effects: ["outline"] },
  fxaa: { ...NONE, antialias: "fxaa", effects: ["fxaa"] },
  smaa: { ...NONE, antialias: "smaa", effects: ["smaa"] },
  msaa: { ...NONE, antialias: "msaa", effects: ["msaa"] },
} satisfies Readonly<Record<string, EffectFrame>>;

type FrameName = keyof typeof FRAMES;

/**
 * The backend tolerance of an effect frame: a pixel differs when one channel differs by more than THRESHOLD levels,
 * and at most the share of the frame may differ. The default is the tolerance of the materials (materials.spec.ts).
 * The ambient occlusion differs more: GTAONode and GTAOPass sample the depth in other ways, so the dark band at the
 * foot of a wall is weaker on WebGPU. The measured shares of 2026-10-16: all 1.8 %, ao 1.3 %, bloom 0.28 %,
 * outline 0.10 %, fxaa 0.01 %, smaa 0.21 %, msaa 0.09 %.
 */
const THRESHOLD = 24;
const MAX_SHARE: Readonly<Record<FrameName, number>> = {
  all: 0.025,
  ao: 0.02,
  bloom: 0.015,
  outline: 0.015,
  fxaa: 0.015,
  smaa: 0.015,
  msaa: 0.015,
};

/** The entity of the outline. */
const SELECTED = "armchair";
// The assets and the effect chunks load slowly in the worker under a load.
// A CI runner and the Linux container draw on the CPU: the waits grow by the CI wait factor (ci-timing.ts).
const READY = { timeout: ciWaitMs(60_000) };
test.describe.configure({ timeout: ciWaitMs(180_000) });

/** The ops that disable the effects that the frame does not draw. */
function opsOf(frame: EffectFrame): SceneOp[] {
  return [
    { op: "set", path: "/environment/ao/on", value: frame.ao },
    { op: "set", path: "/environment/bloom/on", value: frame.bloom },
    { op: "set", path: "/environment/antialias", value: frame.antialias },
  ];
}

/** Open a scene of the showroom with a query and wait for the first frame with every asset. */
async function open(page: Page, scene: string, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The built files of the showroom on both backends: the KTX2 textures and the LOD files of the build.
  await page.goto(`/scene.html?project=showroom&scene=scenes/${scene}.scene.json&camera=front${query}`);
  const view = page.getByTestId("scene-view");
  await expect(view, `the page errors: ${errors.join("; ")}`).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("#status")).toHaveText("");
}

/** Open the effects scene on the ultra tier, draw one frame of the set and check its effects in the stats. */
async function openFrame(page: Page, name: FrameName, query: string): Promise<void> {
  const frame: EffectFrame = FRAMES[name];
  await open(page, "effects", `&tier=ultra${query}`);
  // The ops travel as JSON text: the serializable type of a scene op is too deep for the checker.
  const refusal = await page.evaluate(
    (text) => globalThis.__scenity?.apply(JSON.parse(text) as SceneOp[]),
    JSON.stringify(opsOf(frame)),
  );
  expect(refusal).toBeNull();
  await page.evaluate((ids) => globalThis.__scenity?.select?.(ids), frame.select ? [SELECTED] : []);
  await page.evaluate(() => globalThis.__scenity?.frame());
  const stats = await page.evaluate(() => globalThis.__scenity?.stats());
  expect(stats?.effects).toEqual(frame.effects);
}

/** A picture of the canvas. */
function shot(page: Page): Promise<Buffer> {
  return page.getByTestId("scene-view").screenshot({ animations: "disabled", caret: "hide", scale: "css" });
}

/** Attach the pictures of a failed compare. */
async function attach(info: TestInfo, pictures: readonly (readonly [string, Buffer])[]): Promise<void> {
  for (const [file, body] of pictures) {
    writeFileSync(info.outputPath(file), body);
    await info.attach(file, { path: info.outputPath(file) });
  }
}

/** Skip a test of another project. */
function onlyIn(project: string): void {
  test.skip(test.info().project.name !== project, `this set runs in the project ${project}`);
}

/** True when the browser of the page has a WebGPU adapter. */
async function hasAdapter(page: Page): Promise<boolean> {
  // A page of the origin with no scene (the server answers 404): WebGPU needs a secure context, as the loopback is.
  await page.goto("/assets/no-page");
  return page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu !== undefined && (await gpu.requestAdapter()) !== null;
  });
}

/** The two pictures differ by no pixel. */
async function expectSame(context: BrowserContext, info: TestInfo, a: Buffer, b: Buffer, label: string) {
  const diff = await diffFrames(context, a, b, 0, Number.POSITIVE_INFINITY);
  console.log(`[effects-same] ${JSON.stringify({ label, differ: diff.differ })}`);
  if (diff.differ !== 0)
    await attach(info, [
      ["a.png", a],
      ["b.png", b],
      ["differ.png", Buffer.from(diff.map, "base64")],
    ]);
  expect(diff.differ, label).toBe(0);
}

test.describe("the effects with WebGL in the generic scene worker", () => {
  for (const name of Object.keys(FRAMES) as FrameName[]) {
    test(`effect ${name}: WebGL`, async ({ page }) => {
      onlyIn("scene");
      await openFrame(page, name, "");
      await expect(page.getByTestId("scene-view")).toHaveAttribute("data-renderer", "worker");
      await expect(page.getByTestId("scene-view")).toHaveScreenshot(`showroom--effects-${name}.png`);
    });
  }

  test("the worker and the main thread draw the same effect frame", async ({ context }, info) => {
    onlyIn("scene");
    const shots: Buffer[] = [];
    for (const worker of ["1", "0"]) {
      const page = await context.newPage();
      await openFrame(page, "all", `&worker=${worker}`);
      shots.push(await shot(page));
      await page.close();
    }
    const [worker, main] = shots as [Buffer, Buffer];
    await expectSame(context, info, worker, main, "worker and main thread");
  });

  test("each tier caps the effects", async ({ page }) => {
    onlyIn("scene");
    const caps = {
      low: ["outline"],
      medium: ["outline", "fxaa"],
      high: ["bloom", "outline", "fxaa"],
      ultra: ["ao", "bloom", "outline", "smaa"],
    } as const;
    for (const [tier, effects] of Object.entries(caps)) {
      await open(page, "effects", `&tier=${tier}&sel=${SELECTED}`);
      const stats = await page.evaluate(() => globalThis.__scenity?.stats());
      expect(stats?.tier).toBe(tier);
      expect(stats?.effects, `the effects of the tier ${tier}`).toEqual(effects);
    }
  });

  test("a frame with no effect that draws is the frame of the scene with no effect value", async ({
    context,
  }, info) => {
    onlyIn("scene");
    const shots: Buffer[] = [];
    // The low tier draws no effect of the effects scene when nothing is selected.
    for (const scene of ["effects", "main"]) {
      const page = await context.newPage();
      await open(page, scene, "&tier=low");
      expect(await page.evaluate(() => globalThis.__scenity?.stats().then((stats) => stats.effects))).toEqual([]);
      await page.evaluate(() => globalThis.__scenity?.frame());
      shots.push(await shot(page));
      await page.close();
    }
    const [effects, main] = shots as [Buffer, Buffer];
    await expectSame(context, info, effects, main, "effects scene and main scene, low tier");
  });
});

test.describe("the effects with WebGPU, and WebGL against WebGPU", () => {
  test.beforeEach(async ({ page }) => {
    onlyIn("scene-webgpu");
    test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser");
  });

  for (const name of Object.keys(FRAMES) as FrameName[]) {
    test(`effect ${name}: WebGPU`, async ({ page }) => {
      await openFrame(page, name, "&backend=webgpu");
      expect(await page.evaluate(() => globalThis.__scenity?.stats().then((stats) => stats.backend))).toBe("webgpu");
      await expect(page.getByTestId("scene-view")).toHaveScreenshot(`showroom--effects-${name}.png`);
    });

    test(`effect ${name}: WebGL and WebGPU`, async ({ context }, info) => {
      const shots: Buffer[] = [];
      for (const query of ["&worker=0", "&backend=webgpu"]) {
        const page = await context.newPage();
        await openFrame(page, name, query);
        shots.push(await shot(page));
        await page.close();
      }
      const [gl, gpu] = shots as [Buffer, Buffer];
      const diff = await diffFrames(context, gpu, gl, THRESHOLD);
      const share = diff.over / (diff.width * diff.height);
      const differ = diff.differ / (diff.width * diff.height);
      console.log(`[effect-backends] ${JSON.stringify({ name, share, differ, maxDelta: diff.maxDelta })}`);
      if (share > MAX_SHARE[name] || diff.differ < 0) {
        await attach(info, [
          ["webgpu.png", gpu],
          ["webgl.png", gl],
          ["differ.png", Buffer.from(diff.map, "base64")],
        ]);
      }
      expect(diff.differ, `${name}: the two pictures have the same size`).toBeGreaterThanOrEqual(0);
      expect(
        share,
        `${name}: ${String(diff.over)} pixels differ by more than ${String(THRESHOLD)}`,
      ).toBeLessThanOrEqual(MAX_SHARE[name]);
    });
  }
});
