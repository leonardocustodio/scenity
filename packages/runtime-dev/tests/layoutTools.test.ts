// SPDX-License-Identifier: Apache-2.0
// The generic layout tools on the scenes of a document core with no render (`builderMetricContext`): measure, clearance
// and visibility on the showroom with its built models; reach and walk paths on the robot of the characters sample.
// Each tool gives the values of its metrics, a readout and the shapes of the overlay, and a tool with no input says
// why.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createMetricRegistry, type MetricContext } from "@scenity/rules";
import {
  boxGap,
  CLEARANCE_DEFAULTS,
  REACH_DEFAULTS,
  runLayoutTool,
  type LayoutToolResult,
} from "../src/layoutTools/index";
import { MetricScene, RobotAssets, sampleScene, sampleSequence, ShowroomAssets } from "./metricHelpers";

const registry = createMetricRegistry();

/** The value of a metric with the same arguments, straight from the registry. */
function direct(ctx: MetricContext, metric: string, args: unknown): number | null {
  const outcome = registry.evaluate(metric, ctx, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result.value;
}

/** The value of the first metric of a tool result. */
const first = (result: LayoutToolResult): number | null => result.metrics[0]?.result?.value ?? null;

let showroom: MetricScene;
let room: MetricContext;

beforeAll(async () => {
  showroom = await new MetricScene(new ShowroomAssets()).load(sampleScene("showroom/scenes/main.scene.json"));
  room = showroom.context();
});

afterAll(() => {
  showroom.dispose();
});

describe("the layout tools on the showroom", () => {
  it("measure: the distance of two selected props is the distance metric, with its parts", () => {
    const result = runLayoutTool(room, { tool: "measure", selection: ["armchair", "ottoman"] });
    expect(result.ok).toBe(true);
    expect(first(result)).toBe(direct(room, "distance", { from: "entity:armchair", to: "entity:ottoman" }));
    expect(first(result)).toBeCloseTo(Math.hypot(1.4, 1.45), 4);
    expect(result.lines[0]).toMatch(/^entity:armchair to entity:ottoman: 2\.02 m \(floor 2\.02 m, rise 0\.0 cm\)$/);
    // The line, the run over the floor and the rise; a dot at each end; the length as a label.
    expect(result.overlay.lines.map((line) => line.tone)).toEqual(["measure", "part", "part"]);
    expect(result.overlay.labels.map((label) => label.text)).toEqual(["2.02 m"]);
  });

  it("measure: two picks and a socket; no ends say what the tool needs", () => {
    const picks = runLayoutTool(room, { tool: "measure", from: [0, 0, 0], to: [3, 4, 0] });
    expect(first(picks)).toBe(5);
    const socket = runLayoutTool(room, { tool: "measure", from: "entity:table#top", to: "entity:lantern" });
    expect(first(socket)).toBe(direct(room, "distance", { from: "entity:table#top", to: "entity:lantern" }));
    const none = runLayoutTool(room, { tool: "measure", selection: ["table"] });
    expect(none.ok).toBe(false);
    expect(none.reason).toContain("two ends");
    expect(runLayoutTool(room, { tool: "measure", from: "entity:nothing", to: "entity:table" }).ok).toBe(false);
  });

  it("clearance: the table and its nearest neighbour, with the walkway through the gap", () => {
    const result = runLayoutTool(room, { tool: "clearance", selection: ["table"] });
    expect(result.ok).toBe(true);
    expect(result.metrics.map((metric) => metric.metric)).toEqual(["overlap", "walkway"]);
    expect(first(result)).toBe(0);
    expect(result.subjects).toEqual(["table", "coffee-table"]);
    // The gap of the two boxes over the floor, and the free width of a walk through its middle.
    const table = room.entity("table")?.bounds;
    const coffee = room.entity("coffee-table")?.bounds;
    if (table === undefined || table === null || coffee === undefined || coffee === null) throw new Error("no box");
    const gap = boxGap(table, coffee, "floor").gap;
    expect(result.metrics[1]?.result?.value).toBeCloseTo(gap, 3);
    expect(result.lines).toEqual([`table to coffee-table: ${gap.toFixed(2)} m, walkway ${gap.toFixed(2)} m`]);
    // The lantern on the table and the floor under it are not neighbours.
    expect(result.lines.join(" ")).not.toMatch(/lantern|floor/);
  });

  it("clearance: the coffee table is narrow to the armchair, and a pushed ottoman overlaps it", async () => {
    const coffee = runLayoutTool(room, { tool: "clearance", selection: ["coffee-table"] });
    expect(coffee.lines[0]).toMatch(/^coffee-table to ottoman: 29\.8 cm$/);
    expect(coffee.lines[1]).toMatch(/^coffee-table to armchair: 46\.5 cm, walkway 46\.5 cm$/);
    const tones = coffee.overlay.lines.filter((line) => line.tone !== "place").map((line) => line.tone);
    expect(tones).toEqual(["narrow", "narrow", "measure"]);
    const pushed = new MetricScene(new ShowroomAssets());
    await pushed.load(sampleScene("showroom/scenes/main.scene.json"));
    await pushed.core.patch([
      { op: "set", path: "/entities/ottoman/components/transform/position", value: [-1.2, 0, 0.6] },
    ]);
    const clash = runLayoutTool(pushed.context(), { tool: "clearance", selection: ["ottoman"] });
    expect(first(clash)).toBeGreaterThan(0.1);
    expect(clash.lines[0]).toMatch(/^Overlap: ottoman\+coffee-table: /);
    expect(clash.overlay.lines.some((line) => line.tone === "blocked")).toBe(true);
    pushed.dispose();
    expect(CLEARANCE_DEFAULTS.walkway).toBe(0.6);
    expect(runLayoutTool(room, { tool: "clearance", selection: [] }).reason).toContain("select one");
  });

  it("visibility: the front camera sees the front of the shelf; an eye behind the armchair does not", () => {
    const seen = runLayoutTool(room, { tool: "visibility", selection: ["front", "shelf"] });
    expect(first(seen)).toBe(1);
    expect(seen.lines[0]).toContain("9 of 9 points visible");
    expect(seen.overlay.lines.filter((line) => line.tone === "walk")).toHaveLength(9);
    const camera = runLayoutTool(room, { tool: "visibility", selection: ["shelf"], viewpoint: [0.4, 1.7, 4.6] });
    expect(first(camera)).toBe(1);
    const hidden = runLayoutTool(room, { tool: "visibility", target: "shelf", eye: [-2.5, 0.6, 2.5], grid: 2 });
    expect(first(hidden)).toBeLessThan(1);
    expect(hidden.overlay.lines.filter((line) => line.tone === "blocked").length).toBeGreaterThan(0);
    expect(runLayoutTool(room, { tool: "visibility", selection: ["shelf"] }).reason).toContain("eye");
  });

  it("reach and walk on a scene with no character and no walker say why", () => {
    expect(runLayoutTool(room, { tool: "reach", selection: ["table"] }).reason).toContain("character");
    expect(runLayoutTool(room, { tool: "walk", selection: [] }).reason).toContain("locomotion");
  });
});

describe("the layout tools on the robot of the characters sample", () => {
  let pickup: MetricScene;

  beforeAll(async () => {
    const scene = sampleScene("characters/scenes/pickup.scene.json");
    pickup = await new MetricScene(new RobotAssets()).load(
      scene,
      sampleSequence("characters/sequences/pickup.sequence.json"),
    );
  });

  afterAll(() => {
    pickup.dispose();
  });

  it("reach: the sphere of the robot arm; the cup is out of reach at the start and in reach at the table", async () => {
    const start = runLayoutTool((await pickup.at(0)).context(), { tool: "reach", selection: ["robot", "cup"] });
    expect(start.ok).toBe(true);
    expect(first(start)).toBeLessThan(0);
    expect(start.lines[1]).toMatch(/^entity:cup: out of reach by /);
    const ctx = (await pickup.at(3800)).context();
    const there = runLayoutTool(ctx, { tool: "reach", selection: ["robot", "cup"], side: "right" });
    const args = there.metrics[0]?.args as { arm: number; from: string; plane: string };
    expect(args).toMatchObject({ from: "entity:robot#rightUpperArm", plane: "space" });
    expect(first(there)).toBe(direct(ctx, "reach", { entity: "robot", target: "entity:cup", ...args }));
    expect(first(there)).toBeGreaterThanOrEqual(0);
    // The arm of the robot is the length of its arm bones: about 0.6 m at the scale of the sample.
    expect(args.arm).toBeGreaterThan(0.5);
    expect(args.arm).toBeLessThan(0.75);
    // Three great circles, the floor ring, the post and the line to the target.
    expect(there.overlay.lines.map((line) => line.tone)).toEqual(["reach", "reach", "reach", "part", "reach", "reach"]);
    const labels = there.overlay.labels.map((label) => label.text);
    expect(labels[0]).toBe(`robot reach ${(args.arm * 100).toFixed(1)} cm`);
    expect(labels[1]).toMatch(/^in reach: /);
  });

  it("reach: a stand point reaches over the floor with the default arm; no target draws the sphere only", () => {
    const ctx = pickup.context();
    const spot = runLayoutTool(ctx, { tool: "reach", selection: ["spot", "cup"] });
    expect(spot.metrics[0]?.args).toMatchObject({ arm: REACH_DEFAULTS.arm, plane: "floor", from: "entity:spot" });
    const alone = runLayoutTool(ctx, { tool: "reach", selection: ["robot"] });
    expect(alone.metrics).toEqual([]);
    expect(alone.lines[1]).toContain("No target");
  });

  it("walk: the planned path of the robot around the table to its stand point", () => {
    const ctx = pickup.context();
    const result = runLayoutTool(ctx, { tool: "walk", selection: ["robot"] });
    expect(result.ok).toBe(true);
    expect(result.metrics.map((metric) => metric.metric)).toEqual(["routeClear", "walkway"]);
    expect(first(result)).toBe(0);
    const legs = ctx.walks("robot");
    expect(legs).toHaveLength(1);
    expect(result.overlay.lines[0]?.points.map(([x, , z]) => [x, z])).toEqual(legs[0]?.map(([x, z]) => [x, z]));
    expect(result.overlay.lines[0]?.tone).toBe("walk");
    expect(result.lines[0]).toMatch(/^robot leg 0: \d\.\d\d m long, .* free, no solid within 10\.0 cm$/);
    // With nothing selected, the tool shows each walker of the scene.
    expect(runLayoutTool(ctx, { tool: "walk" }).subjects).toEqual(["robot"]);
    expect(runLayoutTool(ctx, { tool: "walk", selection: ["cup"] }).reason).toContain("the walkers: robot");
  });

  it("walk: the robot of the table scene walks around the table, clear of it", async () => {
    const table = await new MetricScene(new RobotAssets()).load(sampleScene("characters/scenes/table.scene.json"));
    const result = runLayoutTool(table.context(), { tool: "walk", selection: ["robot"] });
    expect(result.metrics[0]?.result?.value).toBe(0);
    const path = result.overlay.lines[0]?.points ?? [];
    expect(path.length).toBeGreaterThan(2);
    // No point of the path is inside the table (1.4 m × 0.8 m at the middle of the room).
    expect(path.some(([x, , z]) => Math.abs(x) < 0.7 && Math.abs(z) < 0.4)).toBe(false);
    table.dispose();
  });
});
