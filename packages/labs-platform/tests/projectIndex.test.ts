// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the frame index of a scene project. The samples give plans that are not empty from their documents. The
 * jobs have stable keys of a scene frame (`sceneFrameKey`, version 2). The order of the jobs is the order of the
 * queue (each time, each view, each size).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { frameKey, sceneFrameKey, sceneKeyInput, takeKeyOf } from "../src/frameKey";
import { planJobs, planTimes, PLAN_STEP_MS, type IndexPlan } from "../src/indexSource";
import { documentCameras, projectPlans, sequenceMoments, PROJECT_DOCUMENT } from "../src/projectIndex";

const SAMPLES = join(import.meta.dir, "../../../samples");
const HASH = "0123456789abcdef0123456789abcdef";
const SIZES = [160, 640];

/** The project document and its scene and sequence documents (as the host reads them). */
function sample(name: string): { project: Record<string, unknown>; files: Record<string, unknown> } {
  const read = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, name, path), "utf8")) as unknown;
  const project = read(PROJECT_DOCUMENT) as Record<string, unknown>;
  const paths = [
    ...((project.scenes as string[] | undefined) ?? []),
    ...((project.sequences as string[] | undefined) ?? []),
  ];
  return { project, files: Object.fromEntries(paths.map((path) => [path, read(path)])) };
}

function plansOf(name: string): IndexPlan[] {
  const { project, files } = sample(name);
  return projectPlans(project, files);
}

describe("the plans of the showroom", () => {
  test("one still plan of the main scene with the document cameras", () => {
    const plans = plansOf("showroom");
    expect(plans.map((plan) => plan.source)).toEqual(["scene:scenes/main.scene.json"]);
    const [plan] = plans;
    expect(plan?.views).toEqual(["front", "top"]);
    expect(plan?.durationMs).toBe(0);
    expect(plan?.moments).toEqual([0]);
    expect(plan?.tier).toBe("high");
    expect(Object.keys(plan?.scene?.documents ?? {})).toEqual([PROJECT_DOCUMENT, "scenes/main.scene.json"]);
  });

  test("the fill plan is not empty and its keys are stable", () => {
    const jobs = planJobs(plansOf("showroom")[0]!, HASH, SIZES);
    expect(jobs.map((job) => [job.input.timeMs, job.input.view, job.size])).toEqual([
      [0, "front", 160],
      [0, "front", 640],
      [0, "top", 160],
      [0, "top", 640],
    ]);
    // A second read of the files gives the same keys; each key is the scene frame key of its input.
    const again = planJobs(plansOf("showroom")[0]!, HASH, SIZES);
    expect(again.map((job) => job.key)).toEqual(jobs.map((job) => job.key));
    for (const job of jobs) {
      expect(job.key).toMatch(/^[0-9a-f]{32}$/);
      const scene = job.input.scene;
      if (scene === undefined) throw new Error("A job of a project has scene parts.");
      expect(job.key).toBe(sceneFrameKey(sceneKeyInput({ ...job.input, scene })));
      expect(job.key).toBe(frameKey(job.input));
    }
    expect(new Set(jobs.map((job) => job.key)).size).toBe(2);
  });

  test("a change of the scene document or of the content hash changes the keys", () => {
    const { project, files } = sample("showroom");
    const before = planJobs(projectPlans(project, files)[0]!, HASH, SIZES);
    const scene = structuredClone(files["scenes/main.scene.json"]) as { entities: Record<string, unknown> };
    scene.entities.extra = { parent: null, index: 99, components: {} };
    const moved = planJobs(projectPlans(project, { ...files, "scenes/main.scene.json": scene })[0]!, HASH, SIZES);
    expect(moved[0]?.key).not.toBe(before[0]?.key);
    const other = planJobs(projectPlans(project, files)[0]!, "f".repeat(32), SIZES);
    expect(other[0]?.key).not.toBe(before[0]?.key);
  });
});

describe("the plans of the characters sample", () => {
  test("one plan per sequence over its scene, with the markers and the key times as moments", () => {
    const plans = plansOf("characters");
    expect(plans.map((plan) => plan.source)).toEqual([
      "sequence:sequences/walk-wave.sequence.json",
      "sequence:sequences/pickup.sequence.json",
      "sequence:sequences/table-walk.sequence.json",
    ]);
    const { files } = sample("characters");
    for (const plan of plans) {
      const path = plan.source.slice("sequence:".length);
      const sequence = files[path] as { duration: number; scene: string; markers: Record<string, number> };
      expect(plan.durationMs).toBe(sequence.duration);
      for (const marker of Object.values(sequence.markers)) expect(plan.moments).toContain(marker);
      expect(plan.moments).toEqual(sequenceMoments(sequence));
      expect(plan.scene?.sequence).toEqual(sequence);
      const scenePath = Object.keys(plan.scene?.documents ?? {}).find((key) => key !== PROJECT_DOCUMENT) ?? "";
      expect((files[scenePath] as { id: string }).id).toBe(sequence.scene);
      expect(plan.views).toEqual(documentCameras(files[scenePath]));
    }
  });

  test("the times of a sequence: the 100 ms steps, then the moments that are not a step", () => {
    const plan = plansOf("characters")[0]!;
    const times = planTimes(plan);
    const steps = plan.durationMs / PLAN_STEP_MS + 1;
    const offStep = plan.moments.filter((time) => time % PLAN_STEP_MS !== 0);
    expect(times.length).toBe(steps + offStep.length);
    expect(times.slice(steps).map((time) => time.time)).toEqual(offStep);
    const flagged = times.filter((time) => time.moment).map((time) => time.time);
    expect([...flagged].sort((a, b) => a - b)).toEqual([...plan.moments]);
    const jobs = planJobs(plan, HASH, SIZES);
    expect(jobs.length).toBe(times.length * plan.views.length * SIZES.length);
  });

  test("the take key of a sequence holds its documents and not the time or the view", () => {
    const [walk, pickup] = plansOf("characters") as [IndexPlan, IndexPlan];
    const [first, later] = [planJobs(walk, HASH, SIZES)[0], planJobs(walk, HASH, SIZES).at(-1)];
    if (first === undefined || later === undefined) throw new Error("The plan has jobs.");
    expect(takeKeyOf(first.input)).toBe(takeKeyOf(later.input));
    expect(takeKeyOf(first.input)).not.toBe(takeKeyOf(planJobs(pickup, HASH, SIZES)[0]?.input ?? first.input));
  });
});

describe("the documents of a plan", () => {
  test("a scene with no camera gives the default view; a sequence of an unknown scene gives no plan", () => {
    expect(documentCameras({ entities: { a: { components: {} } } })).toEqual([null]);
    const project = { scenes: ["a.scene.json"], sequences: ["s.sequence.json"] };
    const files = {
      "a.scene.json": { id: "a", entities: {} },
      "s.sequence.json": { id: "s", scene: "b", duration: 1 },
    };
    expect(projectPlans(project, files).map((plan) => plan.source)).toEqual(["scene:a.scene.json"]);
    expect(projectPlans(project, {})).toEqual([]);
  });
});
