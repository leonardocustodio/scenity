// SPDX-License-Identifier: Apache-2.0
// The asset stills: the plan gives a still to each model, environment and texture asset; a fake renderer
// draws them; a change of the source, the import settings, a build output or the renderer makes a still stale; the
// make step draws only the stale stills and removes the stills of IDs that have no asset.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { writeAssetRecord } from "../src/record";
import { makeStills, type StillRenderer, type StillRenderJob } from "../src/stills/make";
import { planStills, stillMode } from "../src/stills/plan";
import { readStillStamps, stillStatus } from "../src/stills/stamps";
import { put, putAsset, record, removeTemps, SHOWROOM, tempProject } from "./helpers";

const IDS = {
  model: "01J9Z6Q3R9STILLMODEL0000AA",
  sky: "01J9Z6Q3R9STILLSKY000000AA",
  image: "01J9Z6Q3R9STILLIMAGE0000AA",
  clip: "01J9Z6Q3R9STILLCLIP00000AA",
  fbx: "01J9Z6Q3R9STILLFBX000000AA",
} as const;

const DAY = new Date("2026-10-15T12:00:00Z");

afterEach(removeTemps);

/** A renderer that records its jobs and gives bytes that name the asset. */
function fakeRenderer(version = "fake-1"): StillRenderer & { jobs: StillRenderJob[]; opened: number } {
  const renderer = {
    version,
    jobs: [] as StillRenderJob[],
    opened: 0,
    open() {
      renderer.opened += 1;
      return Promise.resolve();
    },
    render(job: StillRenderJob) {
      renderer.jobs.push(job);
      return Promise.resolve(new TextEncoder().encode(`still of ${job.id} from ${job.input}`));
    },
  };
  return renderer;
}

/** A project with a model, an HDR map, a PNG texture, a clip and its build outputs. */
function project(): string {
  const dir = tempProject();
  putAsset(dir, "assets/chair.glb", IDS.model);
  putAsset(dir, "assets/sky.hdr", IDS.sky, { kind: "environment", importer: "hdr" });
  putAsset(dir, "assets/wood.png", IDS.image, { kind: "texture", importer: "png" });
  putAsset(dir, "assets/walk.glb", IDS.clip, { kind: "animation" });
  put(dir, `build/${IDS.model}.high.glb`, "built model");
  put(dir, `build/${IDS.sky}.hdr`, "built map");
  return dir;
}

async function states(dir: string, renderer?: string): Promise<Record<string, string>> {
  const plan = await planStills(dir, renderer === undefined ? {} : { renderer });
  return Object.fromEntries(plan.jobs.map((job) => [job.id, job.status]));
}

describe("the asset stills", () => {
  test("the mode of each kind", () => {
    expect(stillMode({ kind: "model", sourcePath: "a.gltf" })).toBe("model");
    expect(stillMode({ kind: "skinned-model", sourcePath: "a.glb" })).toBe("model");
    expect(stillMode({ kind: "environment", sourcePath: "a.hdr" })).toBe("environment");
    expect(stillMode({ kind: "texture", sourcePath: "a.hdr" })).toBe("environment");
    expect(stillMode({ kind: "texture", sourcePath: "a.png" })).toBe("texture");
    expect(stillMode({ kind: "animation", sourcePath: "a.glb" })).toBeNull();
    expect(stillMode({ kind: "acme.clip-family", sourcePath: "a.json" })).toBeNull();
  });

  test("the make step draws each missing still, then each still is current", async () => {
    const dir = project();
    expect(await states(dir)).toEqual({ [IDS.model]: "missing", [IDS.sky]: "missing", [IDS.image]: "missing" });
    const renderer = fakeRenderer();
    const report = await makeStills(dir, renderer, { today: DAY });
    expect(report.made).toEqual([IDS.image, IDS.model, IDS.sky]);
    expect(renderer.opened).toBe(1);
    expect(renderer.jobs.map((job) => [job.mode, job.input, job.width, job.height])).toEqual([
      ["texture", "assets/wood.png", 320, 240],
      ["model", "assets/chair.glb", 320, 240],
      ["environment", "assets/sky.hdr", 320, 240],
    ]);
    expect(readFileSync(join(dir, `stills/${IDS.model}.webp`), "utf8")).toBe(
      `still of ${IDS.model} from assets/chair.glb`,
    );
    expect(readStillStamps(join(dir, "stills/stills.json"))[IDS.sky]).toMatchObject({
      renderer: "fake-1",
      made: "2026-10-15",
    });
    expect(Object.values(await states(dir, "fake-1"))).toEqual(["current", "current", "current"]);
    const again = fakeRenderer();
    expect((await makeStills(dir, again, { today: DAY })).made).toEqual([]);
    expect(again.opened).toBe(0);
  });

  test("a change of the source, the settings or a build output makes one still stale", async () => {
    const dir = project();
    await makeStills(dir, fakeRenderer(), { today: DAY });
    put(dir, "assets/chair.glb", "other bytes of the chair");
    expect(await states(dir)).toMatchObject({ [IDS.model]: "stale", [IDS.sky]: "current", [IDS.image]: "current" });
    const renderer = fakeRenderer();
    expect((await makeStills(dir, renderer, { today: DAY })).made).toEqual([IDS.model]);

    put(dir, `build/${IDS.sky}.hdr`, "other built map");
    expect(await states(dir)).toMatchObject({ [IDS.model]: "current", [IDS.sky]: "stale" });
    await makeStills(dir, fakeRenderer(), { today: DAY });

    const settings = { kind: "texture", importer: "png", settings: { role: "normal" } } as const;
    put(dir, "assets/wood.png.meta.json", writeAssetRecord(record(IDS.image, "wood.png", settings)));
    const plan = await planStills(dir);
    const image = plan.jobs.find((job) => job.id === IDS.image);
    expect(image?.status).toBe("stale");
    expect(image?.reason).toBe("the source, the import settings or the build output changed after 2026-10-15");
  });

  test("a new renderer version makes each still stale; the plan with no version does not compare it", async () => {
    const dir = project();
    await makeStills(dir, fakeRenderer("fake-1"), { today: DAY });
    expect(Object.values(await states(dir, "fake-2"))).toEqual(["stale", "stale", "stale"]);
    expect(Object.values(await states(dir))).toEqual(["current", "current", "current"]);
    expect((await makeStills(dir, fakeRenderer("fake-2"), { today: DAY })).made).toHaveLength(3);
  });

  test("a model with no glTF input fails; a still of an unknown ID goes away", async () => {
    const dir = project();
    putAsset(dir, "assets/lamp.fbx", IDS.fbx, { importer: "fbx" });
    put(dir, "stills/01J9Z6Q3R9GONE0000000000AA.webp", "old still");
    const report = await makeStills(dir, fakeRenderer(), { today: DAY });
    expect(report.failed).toEqual([
      { id: IDS.fbx, reason: "assets/lamp.fbx is not glTF or GLB: import the asset first (cli.ts import)" },
    ]);
    expect(report.removed).toEqual(["stills/01J9Z6Q3R9GONE0000000000AA.webp"]);
    expect(existsSync(join(dir, "stills/01J9Z6Q3R9GONE0000000000AA.webp"))).toBe(false);
  });

  test("the state of a still from its facts", () => {
    const stamp = { inputs: "a", renderer: "r1", made: "2026-10-01" };
    const base = { inputs: "a", stamp, exists: true, renderer: "r1" };
    expect(stillStatus(base)).toEqual({ status: "current", reason: null });
    expect(stillStatus({ ...base, exists: false }).status).toBe("missing");
    expect(stillStatus({ ...base, stamp: undefined }).status).toBe("stale");
    expect(stillStatus({ ...base, inputs: "b" }).status).toBe("stale");
    expect(stillStatus({ ...base, renderer: "r2" }).reason).toBe("the renderer changed after 2026-10-01");
    expect(stillStatus({ ...base, renderer: undefined }).status).toBe("current");
  });

  test("cli.ts stills --check exits with 1 on a missing or stale still and with 0 when all are current", async () => {
    const dir = project();
    const missing = await runCli(["stills", dir, "--check"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("3 stills: 0 current, 3 missing, 0 stale");
    await makeStills(dir, fakeRenderer(), { today: DAY });
    expect((await runCli(["stills", dir, "--check"])).code).toBe(0);
    put(dir, "assets/wood.png", "other pixels");
    const stale = await runCli(["stills", dir, "--check"]);
    expect(stale.code).toBe(1);
    expect(stale.out.find((line) => line.startsWith(IDS.image))).toContain("stale");
    expect((await runCli(["stills", dir])).code).toBe(0);
    expect((await runCli(["stills"])).code).toBe(2);
  });

  test("the showroom has a current still for each of its 7 assets", async () => {
    const plan = await planStills(SHOWROOM);
    expect(plan.jobs.map((job) => job.mode).sort()).toEqual([
      "environment",
      "model",
      "model",
      "model",
      "model",
      "model",
      "model",
    ]);
    expect(plan.jobs.filter((job) => job.status !== "current")).toEqual([]);
  });
});
