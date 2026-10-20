// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity shot`: the arguments, the paths, the player page, the picture comparison and the setup errors. The
 * comparison tests use the counts of the Playwright comparator on two gallery baselines. The last test draws the
 * showroom in headless Chromium under the GPU lock of the labs tools. It compares the two cameras with the gallery
 * baselines of the platform. It runs only with `SCENITY_GPU_TESTS=1` and a Chromium of Playwright on the machine.
 * The reason is that a shared machine does one GPU run at a time. `bun run check:shots` is the same check for CI.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { playerPageHtml } from "../src/page/serve";
import {
  browserPresent,
  compareRgba,
  comparePng,
  countDiffer,
  defaultShotFile,
  fillPath,
  GALLERY_TOLERANCE,
  parseShotArgs,
  pictureLine,
  runShot,
  runShotCommand,
} from "../src/shot/index";

const ROOT = join(import.meta.dir, "../../..");
const SHOWROOM = join(ROOT, "samples/showroom");
const BASELINES = join(ROOT, "apps/editor/tests/gallery/__screenshots__");
const temp = mkdtempSync(join(tmpdir(), "scenity-shot-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** A picture of one colour. */
function plain(width: number, height: number, rgb: readonly [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set([...rgb, 255], index * 4);
  return { width, height, data };
}

describe("scenity shot: the arguments", () => {
  test("the defaults and each option", () => {
    expect(parseShotArgs([])).toEqual({ options: { dir: ".", cameras: [], build: false }, json: false });
    const parsed = parseShotArgs([
      "--project",
      "samples/showroom",
      "--camera",
      "front,top",
      "--sequence",
      "sequences/a.sequence.json",
      "--at",
      "2500",
      "--size",
      "640x400",
      "--backend",
      "webgpu",
      "--tier",
      "medium",
      "--worker",
      "0",
      "--out",
      "shots/{camera}.png",
      "--compare",
      "base/{platform}/{camera}.png",
      "--build",
      "--json",
    ]);
    expect(parsed).toEqual({
      options: {
        dir: "samples/showroom",
        sequence: "sequences/a.sequence.json",
        out: "shots/{camera}.png",
        compare: "base/{platform}/{camera}.png",
        cameras: ["front", "top"],
        at: 2500,
        size: { width: 640, height: 400 },
        backend: "webgpu",
        tier: "medium",
        worker: false,
        build: true,
      },
      json: true,
    });
    expect(parseShotArgs(["samples/showroom"])?.options.dir).toBe("samples/showroom");
  });

  test("a usage error", async () => {
    for (const argv of [
      ["--size", "big"],
      ["--backend", "vulkan"],
      ["--tier", "max"],
      ["--worker", "2"],
      ["--at", "-1"],
      ["--camera"],
      ["--nope"],
      ["a", "b"],
      ["a", "--project", "b"],
    ]) {
      expect(parseShotArgs(argv)).toBeNull();
    }
    const result = await runShotCommand(["--nope"]);
    expect(result.code).toBe(2);
    expect(result.out[0]).toStartWith("usage: ");
  });

  test("a setup error stops the command before the build and the browser", async () => {
    const at = await runShotCommand(["--project", SHOWROOM, "--at", "100"]);
    expect(at).toEqual({ out: ["--at needs a sequence: give --sequence."], code: 1 });
    const out = await runShotCommand(["--project", SHOWROOM, "--camera", "front,top", "--out", "a.png"]);
    expect(out.code).toBe(1);
    expect(out.out[0]).toContain("{camera}");
    const scene = await runShotCommand(["--project", SHOWROOM, "--scene", "scenes/none.scene.json", "--json"]);
    expect(scene.code).toBe(1);
    expect(JSON.parse(scene.out[0] ?? "{}")).toMatchObject({ passed: false });
  });
});

describe("scenity shot: the paths and the page", () => {
  test("the camera and the platform of a path", () => {
    expect(fillPath("x/scene-{platform}/showroom--{camera}.png", "front")).toBe(
      `x/scene-${process.platform}/showroom--front.png`,
    );
    expect(fillPath("x/{camera}.png", null)).toBe("x/scene.png");
    expect(defaultShotFile("/b", { scene: "scenes/main.scene.json", sequence: null })).toBe(
      join("/b", "shots", "main--{camera}.png"),
    );
    expect(defaultShotFile("/b", { scene: "s.scene.json", sequence: "q/walk.sequence.json" }, 2500)).toBe(
      join("/b", "shots", "walk--{camera}@2500.png"),
    );
  });

  test("the player page of a picture: a camera, the path, the start time and a stopped clock", () => {
    const page = playerPageHtml({
      scene: "scenes/main.scene.json",
      sequence: null,
      backend: "webgl",
      tier: "high",
      camera: "front",
      worker: true,
      play: false,
      start: 2500,
    });
    expect(page).toContain(
      'scene="scenes/main.scene.json" sequence="none" backend="webgl" tier="high" camera="front" worker="true" ' +
        'start="2500" adaptive="false" poster="none" muted>',
    );
    expect(page).not.toContain("autoplay");
  });
});

describe("scenity shot: the comparison", () => {
  test("the count of pixelmatch: same, under the threshold, over it, another size", () => {
    const grey = plain(4, 4, [128, 128, 128]);
    expect(compareRgba(grey, plain(4, 4, [128, 128, 128])).differ).toBe(0);
    expect(compareRgba(grey, plain(4, 4, [133, 128, 128])).differ).toBe(0);
    const red = plain(4, 4, [128, 128, 128]);
    red.data.set([255, 0, 0, 255], (1 * 4 + 1) * 4);
    expect(countDiffer(grey.data, red.data, 4, 4, GALLERY_TOLERANCE.threshold)).toBe(1);
    const other = compareRgba(grey, plain(4, 3, [128, 128, 128]));
    expect(other.passed).toBe(false);
    expect(other.baselineSize).toEqual({ width: 4, height: 3 });
  });

  test("two gallery baselines give the count of the Playwright comparator (toHaveScreenshot)", () => {
    const front = readFileSync(join(BASELINES, "scene-darwin/showroom--front.png"));
    const ao = readFileSync(join(BASELINES, "scene-darwin/showroom--effects-ao.png"));
    // Playwright 1.63 getComparator("image/png") with threshold 0.2 counts 10674 pixels for this pair.
    const comparison = comparePng(ao, front);
    expect(comparison.differ).toBe(10674);
    expect(comparison.limit).toBe(1280 * 800 * 0.002);
    expect(comparison.passed).toBe(false);
    expect(comparePng(front, front).passed).toBe(true);
  });

  test("the line of a picture", () => {
    const comparison = { passed: true, differ: 34, limit: 2048, size: { width: 1280, height: 800 } };
    const line = pictureLine({
      camera: "front",
      file: "/s/front.png",
      drawn: { backend: "webgl", renderer: "worker" },
      error: null,
      baseline: "/b/front.png",
      comparison: { ...comparison, baselineSize: comparison.size },
    });
    expect(line).toBe(
      "front: /s/front.png (webgl, worker): in the tolerance of /b/front.png: 34 pixels differ (0.003 %), limit 2048",
    );
    const failed = { camera: null, file: null, drawn: { backend: null, renderer: null }, baseline: null };
    expect(pictureLine({ ...failed, error: "no first frame", comparison: null })).toBe(
      "the scene camera: failed: no first frame",
    );
  });
});

const platformBaselines = existsSync(join(BASELINES, `scene-${process.platform}`, "showroom--front.png"));
const gpu = process.env.SCENITY_GPU_TESTS === "1" && platformBaselines && (await browserPresent());

describe("scenity shot: the showroom in Chromium", () => {
  test.skipIf(!gpu)(
    "the front and top cameras are in the gallery tolerance of their baselines",
    async () => {
      const result = await runShot({
        dir: SHOWROOM,
        cameras: ["front", "top"],
        build: true,
        dist: join(temp, "dist"),
        out: join(temp, "showroom--{camera}.png"),
        compare: join(BASELINES, "scene-{platform}", "showroom--{camera}.png"),
      });
      for (const picture of result.pictures) console.log(`[shot] ${pictureLine(picture)}`);
      expect(result.pictures.map((picture) => picture.drawn)).toEqual([
        { backend: "webgl", renderer: "worker" },
        { backend: "webgl", renderer: "worker" },
      ]);
      expect(result.passed).toBe(true);
    },
    300_000,
  );
});
