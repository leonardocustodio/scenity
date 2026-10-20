// SPDX-License-Identifier: Apache-2.0
// The frame index fills for the showroom. The index plan comes from the documents of the project (`projectPlans` of
// @scenity/labs-platform: the main scene with its document cameras). Each job has the key of a scene frame
// (`sceneFrameKey`), and the scene page draws each job at the size of the index. The test keeps the pictures in an
// index store (in memory here; the host keeps them in its state folder) and reads them again by key.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { planJobs, type IndexPlan } from "@scenity/labs-platform/indexSource";
import { IndexStore, type IndexBackend } from "@scenity/labs-platform/indexStore";
import { PROJECT_DOCUMENT, projectPlans } from "@scenity/labs-platform/projectIndex";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const HASH = "0123456789abcdef0123456789abcdef";
const SIZES = [160, 640];
const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** The plans of the showroom from its documents, as the host reads them. */
function showroomPlans(): IndexPlan[] {
  const read = (path: string): unknown => JSON.parse(readFileSync(join(SHOWROOM, path), "utf8")) as unknown;
  const project = read(PROJECT_DOCUMENT) as { scenes?: string[]; sequences?: string[] };
  const paths = [...(project.scenes ?? []), ...(project.sequences ?? [])];
  return projectPlans(project, Object.fromEntries(paths.map((path) => [path, read(path)])));
}

/** An index backend in memory. */
function memoryBackend(): IndexBackend {
  const files = new Map<string, Uint8Array>();
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, bytes) => Promise.resolve(void files.set(path, bytes)),
    remove: (path) => Promise.resolve(void files.delete(path)),
    removeTree: (path) => {
      for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      return Promise.resolve();
    },
    list: (path) => Promise.resolve([...files.keys()].filter((key) => key.startsWith(`${path}/`))),
  };
}

/** The width of a PNG picture (the IHDR chunk). */
function pngWidth(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16);
}

test("the frame index fills for the showroom", async ({ page }) => {
  const plans = showroomPlans();
  expect(plans.length).toBeGreaterThan(0);
  const store = new IndexStore(memoryBackend(), { flushDelayMs: 0 });
  const jobs = plans.flatMap((plan) => planJobs(plan, HASH, SIZES));
  expect(jobs.length).toBe(4);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: Math.round(size / 1.6) });
    await page.goto("/scene.html?project=showroom");
    await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
    for (const job of jobs.filter((item) => item.size === size)) {
      const view = typeof job.input.view === "string" ? job.input.view : null;
      expect(await page.evaluate((name) => globalThis.__scenity?.camera(name), view)).toBe(true);
      const bytes = new Uint8Array(await page.getByTestId("scene-view").screenshot({ animations: "disabled" }));
      expect(pngWidth(bytes)).toBe(size);
      await store.put({ input: job.input, size, mime: "image/png", bytes });
    }
  }
  for (const job of jobs) {
    const hit = await store.get(job.key, job.size);
    expect(hit?.frame.size).toBe(job.size);
    expect(hit?.bytes.length ?? 0).toBeGreaterThan(500);
  }
  // The two cameras draw two different pictures.
  const [front, top] = await Promise.all(jobs.filter((job) => job.size === 640).map((job) => store.get(job.key, 640)));
  expect(Buffer.from(front?.bytes ?? []).equals(Buffer.from(top?.bytes ?? []))).toBe(false);
});
