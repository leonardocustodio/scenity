// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the layout variants in the host: the bridge events `layout` and `variants`, the run of `labs layout-save`
 * and its answer to the lab, and the layout candidates of the picker. The tests of the search mode of the layout
 * check tool are in the tests of the host plugin that gives the tool (layoutTool.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUTS_DIR } from "../src/layoutCandidates";
import { layoutSaveArgs, tuneParts } from "../src/layoutProtocol";
import { Picker } from "../src/picker";
import { isBridgeEvent, type BridgeVariantsEvent } from "../src/protocol";
import { planRun, WEB_DIR } from "../src/runArgs";
import type { RunResult } from "../src/runs";
import { runLayoutSave, sceneEditEvents, type SceneEditDeps } from "../src/sceneEdit";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeLab, REPO_ROOT } from "./fakeLab";
import { cleanup, tempDir } from "./helpers";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => {
  cleanup(...made);
});

const LAYOUT = { workbench: 1, event: "layout", name: "bay-b", tunes: "room.props.lamp.at.2:-0.5", dry: true } as const;
const VARIANTS: BridgeVariantsEvent = {
  workbench: 1,
  event: "variants",
  seed: 7,
  variants: [
    { id: "v1", label: "lamp stand 10 cm right", tune: "room.props.lamp_stand.at.0:0.6" },
    { id: "v2", label: "screen 19 cm to the back", tune: "room.props.screen.at.2:-1.3,routes.cord.p1.x:0.01" },
  ],
};

function deps(overrides: Partial<SceneEditDeps> = {}): SceneEditDeps {
  return {
    terminals: { claudeTerminals: () => [], input: () => undefined },
    chat: { live: () => [], get: () => ({ prompt: () => undefined }) },
    runs: { start: () => ({ run: "r1", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) }) },
    current: () => REPO_ROOT,
    lab: () => fakeLab().port,
    delay: () => Promise.resolve(),
    ...overrides,
  };
}

describe("the bridge events of the layout variants", () => {
  test("are bridge events with their fields", () => {
    expect(isBridgeEvent(LAYOUT)).toBe(true);
    expect(isBridgeEvent({ ...LAYOUT, tunes: "" })).toBe(true);
    expect(isBridgeEvent({ ...LAYOUT, doc: "lamp stand forward", camera: "side-right", replace: true })).toBe(true);
    expect(isBridgeEvent({ ...LAYOUT, camera: "1.00,2.00,3.00,0.00,0.80,0.00,45.00" })).toBe(true);
    expect(isBridgeEvent({ ...LAYOUT, name: "Bay B" })).toBe(false);
    // The bridge checks the form of each pair. The host plugin gives the paths (the run refuses other paths).
    expect(isBridgeEvent({ ...LAYOUT, tunes: "pose.hatHand.up:0.1" })).toBe(true);
    expect(isBridgeEvent({ ...LAYOUT, tunes: "pose hatHand:0.1" })).toBe(false);
    expect(isBridgeEvent({ ...LAYOUT, tunes: "room.props.cart.at.2:x" })).toBe(false);
    expect(isBridgeEvent({ ...LAYOUT, tunes: "room.props.lamp.at.2:-0.5;rm" })).toBe(false);
    expect(isBridgeEvent({ ...LAYOUT, doc: "a $b" })).toBe(false);
    expect(isBridgeEvent({ ...LAYOUT, camera: "../x" })).toBe(false);
    expect(isBridgeEvent(VARIANTS)).toBe(true);
    expect(isBridgeEvent({ ...VARIANTS, seed: 1.5 })).toBe(false);
    expect(isBridgeEvent({ ...VARIANTS, variants: [{ id: "x1", label: "", tune: "" }] })).toBe(false);
  });

  test("a save of a tune path that the host plugin does not allow starts no run", async () => {
    const started: unknown[] = [];
    const parts = deps({
      runs: {
        start: (...args) => (
          started.push(args),
          { run: "r1", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) }
        ),
      },
    });
    const result = await runLayoutSave(parts, { ...LAYOUT, tunes: "pose.hatHand.up:0.1" });
    expect(result).toMatchObject({ run: null, status: "failed" });
    expect(started).toEqual([]);
  });

  test("a save runs labs layout-save with the tune text in parts of at most 900 characters", async () => {
    const started: unknown[] = [];
    const parts = deps({
      runs: {
        start: (_checkout, command, args, options) => {
          started.push([command, args]);
          options?.onOutput?.("stdout", 'dry run: layout "bay-b" added (1 values); nothing written\n');
          return { run: "r7", done: Promise.resolve({ status: "passed", summary: "" } as RunResult) };
        },
      },
    });
    expect(await runLayoutSave(parts, { ...LAYOUT, camera: "chest" })).toEqual({
      run: "r7",
      dry: true,
      status: "passed",
      output: 'dry run: layout "bay-b" added (1 values); nothing written',
    });
    expect(started).toEqual([["layout-save", ["bay-b", "--tunes=room.props.lamp.at.2:-0.5", "--view=chest", "--dry"]]]);
    const long = Array.from({ length: 60 }, (_, index) => `room.props.lamp.at.0:${String(index)}.123456789`).join(",");
    const parts900 = tuneParts(long);
    expect(parts900.length).toBeGreaterThan(1);
    expect(parts900.every((part) => part.length <= 900)).toBe(true);
    expect(parts900.join(",")).toBe(long);
    expect(tuneParts("")).toEqual([""]);
    // The run plan takes the arguments, renders nothing and starts `bun run labs layout-save`.
    const args = layoutSaveArgs({ ...LAYOUT, tunes: long, dry: false, replace: true, doc: "lamp forward" });
    const plan = planRun(REPO_ROOT, "layout-save", args, { runId: "t1", bun: "bun" });
    expect(plan.argv).toEqual(["bun", "run", "labs", "layout-save", ...args]);
    expect(plan.gpu).toBe(false);
  });

  test("the handler answers a save through the bridge, and gives the variants to the picker", async () => {
    const lab = fakeLab({ layoutResult: null });
    const offered: BridgeVariantsEvent[] = [];
    const handle = sceneEditEvents(deps({ lab: () => lab.port, offer: (event) => offered.push(event) }));
    handle("lab", "visible", LAYOUT);
    handle("lab", "visible", VARIANTS);
    handle("lab", "shadow", VARIANTS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lab.calls).toEqual([
      { call: "layoutResult", args: [{ run: "r1", dry: true, status: "passed", output: "" }] },
    ]);
    expect(offered).toEqual([VARIANTS]);
  });
});

describe("the layout candidates of the picker", () => {
  test("the saved layouts of the checkout and the variants of the last search are tune candidates", () => {
    const checkout = tempDir("layouts");
    made.push(checkout);
    const folder = join(checkout, WEB_DIR, LAYOUTS_DIR);
    mkdirSync(folder, { recursive: true });
    const file = { name: "bay-b", doc: "lamp stand forward", camera: "chest", tunes: { "room.props.lamp.at.2": -0.5 } };
    writeFileSync(join(folder, "bay-b.json"), JSON.stringify(file));
    writeFileSync(join(folder, "broken.json"), "{ not json");
    writeFileSync(join(folder, "Bad Name.json"), JSON.stringify(file));
    const picker = new Picker({
      shadow: () => fakeLab().port,
      labUrl: () => null,
      runs: { running: () => null, startRun: () => Promise.reject(new Error("no runs")) },
      worktrees: () => [],
      isCheckout: () => Promise.resolve(false),
      current: () => checkout,
      emit: () => undefined,
      pictures: { put: () => "p1" },
    });
    expect(picker.candidates().map((item) => item.id)).toEqual(["defaults", "layout-bay-b"]);
    picker.offer(VARIANTS.seed, VARIANTS.variants);
    const candidates = picker.candidates();
    expect(candidates.slice(1)).toEqual([
      {
        id: "layout-bay-b",
        label: "Layout bay-b: lamp stand forward",
        kind: "tune",
        tune: "room.props.lamp.at.2:-0.5",
      },
      {
        id: "search-7-v1",
        label: "Search 7 v1: lamp stand 10 cm right",
        kind: "tune",
        tune: "room.props.lamp_stand.at.0:0.6",
      },
      {
        id: "search-7-v2",
        label: "Search 7 v2: screen 19 cm to the back",
        kind: "tune",
        tune: "room.props.screen.at.2:-1.3,routes.cord.p1.x:0.01",
      },
    ]);
    // A new search replaces the variants of the last one.
    picker.offer(8, []);
    expect(picker.candidates().map((item) => item.id)).toEqual(["defaults", "layout-bay-b"]);
  });
});
