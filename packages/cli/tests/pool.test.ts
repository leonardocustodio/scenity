// SPDX-License-Identifier: Apache-2.0
/**
 * The scene pool of `scenity pool`. The tests check the spec and the content stamp of the player target, and the
 * files of a pool. In headless Chromium, the pool starts and refuses a call without its token. A `scenity shot`
 * through the pool gives the same picture as a shot without it, and the second shot gets a warm page. A sheet and a
 * clip use the pool. The pool stops cleanly: no pool files stay, and no health answer comes. The browser tests run
 * only with `SCENITY_GPU_TESTS=1` and a Chromium of Playwright. The caller takes the GPU lock of the machine.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserPresent } from "../src/page/browser";
import { runClip } from "../src/clip/run";
import { findScenePool, SCENE_POOL_DIR_ENV, scenePoolDir } from "../src/pool/client";
import { clearPool, poolRuns, readPool, writePool } from "../src/pool/files";
import { startScenePool } from "../src/pool/server";
import { readSpec, specKey, specVersion, type PlayerSpec } from "../src/pool/target";
import { runSheet } from "../src/sheet/run";
import { comparePng, runShot } from "../src/shot/index";

const ROOT = join(import.meta.dir, "../../..");
const temp = mkdtempSync(join(tmpdir(), "scenity-pool-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const gpu = process.env.SCENITY_GPU_TESTS === "1" && (await browserPresent());

/** A copy of the showroom without its builds, so the test owns its documents and its build. */
function showroom(): string {
  const dir = join(temp, "showroom");
  if (!existsSync(dir)) {
    cpSync(join(ROOT, "samples/showroom"), dir, {
      recursive: true,
      filter: (path) => !path.includes("/dist") && !path.includes("/.scenity"),
    });
  }
  return dir;
}

function spec(dir: string): PlayerSpec {
  return {
    out: join(dir, "dist"),
    dir,
    page: { scene: "scenes/main.scene.json", sequence: null, backend: "webgl", tier: "high", worker: true },
    width: 1280,
    height: 800,
  };
}

describe("the scene pool: the player target and the files", () => {
  test("a spec needs absolute folders, the player options and a size", () => {
    const good = spec("/p");
    expect(readSpec(good)).toEqual(good);
    expect(() => readSpec({ ...good, out: "dist" })).toThrow(/absolute/);
    expect(() => readSpec({ ...good, page: { scene: "a" } })).toThrow(/backend/);
    expect(() => readSpec({ ...good, width: 3 })).toThrow(/width/);
    expect(specKey(good)).toBe(specKey({ ...good }));
    expect(specKey(good)).not.toBe(specKey({ ...good, width: 640 }));
  });

  test("the version follows the documents of the page", () => {
    const dir = showroom();
    const before = specVersion(spec(dir));
    expect(specVersion(spec(dir))).toBe(before);
    const scene = join(dir, "scenes/main.scene.json");
    const text = readFileSync(scene, "utf8");
    writeFileSync(scene, text.replace('"name": "Showroom"', '"name": "Showroom 2"'));
    expect(specVersion(spec(dir))).not.toBe(before);
    writeFileSync(scene, text);
    expect(specVersion(spec(dir))).toBe(before);
  });

  test("the pool files: the folder, pool.json and the token come and go", async () => {
    const dir = join(temp, "files");
    expect(scenePoolDir({ [SCENE_POOL_DIR_ENV]: dir })).toBe(dir);
    const info = {
      version: 1,
      pid: process.pid,
      origin: "http://127.0.0.1:9",
      checkout: ROOT,
      pages: 1,
      started: "now",
    };
    writePool(dir, info as never, "c".repeat(64));
    expect(readPool(dir)?.info.pid).toBe(process.pid);
    expect(poolRuns(dir)).toBe(true);
    // No server answers on the origin, so no tool takes this pool.
    expect(await findScenePool(dir)).toBeNull();
    clearPool(dir);
    expect(readPool(dir)).toBeNull();
  });
});

describe("the scene pool in headless Chromium", () => {
  test.skipIf(!gpu)(
    "the pool starts; shot, sheet and clip go through it; a pool picture equals a local picture; the pool stops",
    async () => {
      const dir = showroom();
      const poolDir = join(temp, "pool");
      const lock = join(temp, "gpu.lock");
      process.env[SCENE_POOL_DIR_ENV] = poolDir;
      const pool = await startScenePool({ pages: 2, dir: poolDir, lock });
      try {
        expect(readPool(poolDir)?.info.origin).toBe(pool.origin);
        expect((await fetch(`${pool.origin}/__pool/status`)).status).toBe(401);
        const client = await findScenePool();
        expect(client?.origin).toBe(pool.origin);

        const base = { dir, cameras: ["front"], build: true, lock };
        const local = await runShot({ ...base, local: true, out: join(temp, "local--{camera}.png") });
        expect(local.passed).toBe(true);
        const pooled = await runShot({ ...base, build: false, out: join(temp, "pool--{camera}.png") });
        expect(pooled.passed).toBe(true);
        const a = readFileSync(join(temp, "local--front.png"));
        const b = readFileSync(join(temp, "pool--front.png"));
        expect(b.equals(a) || comparePng(b, a, { threshold: 0, maxDiffPixelRatio: 0 }).differ === 0).toBe(true);

        // The second lease of the same spec gets the warm page.
        const front = { ...spec(dir), page: { ...spec(dir).page, camera: "front" } };
        const warm = await client?.open(front);
        expect(warm?.warm).toBe(true);
        const again = await warm?.shot();
        await warm?.close();
        expect(again?.equals(a)).toBe(true);

        const sheet = await runSheet({ dir, times: [], cameras: ["front", "top"], lock, out: join(temp, "s.png") });
        expect(sheet.passed).toBe(true);
        const status = await client?.json<{ leases: number; pages: { warm: boolean }[] }>("GET", "status");
        expect(status?.leases).toBe(0);
        expect(status?.pages.filter((page) => page.warm)).toHaveLength(2);
      } finally {
        await pool.stop();
        delete process.env.SCENITY_SCENE_POOL_DIR;
      }
      expect(readPool(poolDir)).toBeNull();
      expect(await findScenePool(poolDir)).toBeNull();
      await pool.stopped;
    },
    600_000,
  );

  test.skipIf(!gpu)(
    "a clip through the pool equals a clip in the own browser",
    async () => {
      const dir = join(ROOT, "samples/characters");
      const poolDir = join(temp, "pool-clip");
      const lock = join(temp, "gpu.lock");
      const dist = join(temp, "characters-dist");
      const base = { dir, sequence: "sequences/walk-wave.sequence.json", from: 0, to: 500, fps: 6, dist, lock };
      const local = await runClip({ ...base, build: true, local: true, out: join(temp, "local.webm") });
      expect(local.passed).toBe(true);
      process.env[SCENE_POOL_DIR_ENV] = poolDir;
      const pool = await startScenePool({ pages: 1, dir: poolDir, lock });
      try {
        const pooled = await runClip({ ...base, out: join(temp, "pool.webm") });
        expect(pooled.passed).toBe(true);
        expect(pooled.codec).toBe(local.codec);
        expect(pooled.times).toEqual(local.times);
      } finally {
        await pool.stop();
        delete process.env.SCENITY_SCENE_POOL_DIR;
      }
      expect(poolRuns(poolDir)).toBe(false);
    },
    600_000,
  );
});
