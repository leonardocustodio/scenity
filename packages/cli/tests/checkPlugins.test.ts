// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity check` runs the simulations and the systems of the project plugins, so a rule measures the outcome of a
 * simulation. The road crossing sample (samples/sim-road, the traffic plugin) passes. A copy with a car that does not
 * stop for the signal fails the two block rules of the crossing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheckCommand, type CheckReport } from "../src/check/index";

const ROOT = join(import.meta.dir, "../../..");
const SAMPLE = join(ROOT, "samples/sim-road");
// The copy stays in the workspace (in the state folder that Git ignores), so the resolver finds the plugin package.
mkdirSync(join(ROOT, ".scenity/tmp"), { recursive: true });
const temp = mkdtempSync(join(ROOT, ".scenity/tmp/check-plugins-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

async function report(dir: string): Promise<{ code: number; report: CheckReport }> {
  const json = await runCheckCommand([dir, "--json"]);
  return { code: json.code, report: JSON.parse(json.out.join("\n")) as CheckReport };
}

/** The status of each rule of a report. */
function statuses(checked: CheckReport): Record<string, string> {
  return Object.fromEntries(checked.rows.map((row) => [row.rule, row.status]));
}

interface ActionTrack {
  entity?: string;
  keys: { args?: Record<string, unknown> }[];
}

describe("scenity check with the systems of the plugins", () => {
  test("the road crossing passes, and its first queued car waits at the stop line", async () => {
    const { code, report: checked } = await report(SAMPLE);
    expect(code).toBe(0);
    expect(statuses(checked)).toEqual({
      // A rule of the project on a metric of the dev face of the traffic plugin.
      "road.carGap": "pass",
      "traffic.carsClearOfWalkers": "pass",
      "traffic.crossingClearOnWalk": "pass",
      "traffic.queueKeepsGap": "pass",
      "traffic.carsWaitAtLine": "pass",
    });
    // The car stands where the simulation put it, not at its place in the scene document (far off the road).
    const wait = checked.rows.find((row) => row.rule === "traffic.carsWaitAtLine");
    expect(wait?.value ?? 0).toBeCloseTo(2.05, 2);
  });

  test("a car that does not stop for the signal fails the rules of the crossing", async () => {
    const dir = join(temp, "red-runner");
    cpSync(SAMPLE, dir, { recursive: true, filter: (path) => !path.includes("/dist") });
    const file = join(dir, "sequences/rush.sequence.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { tracks: ActionTrack[] };
    const track = doc.tracks.find((item) => item.entity === "car-5");
    const key = track?.keys[0];
    if (key?.args === undefined) throw new Error("the sequence has no key of car-5");
    key.args.ignoresSignal = true;
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const { code, report: checked } = await report(dir);
    expect(code).toBe(1);
    expect(statuses(checked)).toMatchObject({
      "traffic.carsClearOfWalkers": "fail",
      "traffic.crossingClearOnWalk": "fail",
      "traffic.queueKeepsGap": "pass",
    });
  });
});
