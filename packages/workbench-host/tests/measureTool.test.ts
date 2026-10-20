// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the measure tool of the host: `lab_measure` against a scripted lab, and the measurements in the context
 * packet. The scripted lab answers the calls `measureBetween` and `measurements` as the measure tool of the lab page
 * does (apps/editor `core/editor/useMeasure.ts`). The tests of the reach are in the tests of the host plugin that
 * gives it (its tests/measureTool.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { buildPacket } from "../src/context";
import { handleToolRequest } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import { measureBlock, measureLine } from "../src/tools/measure";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

/** A measurement as the lab gives it: the ends and the distance with its parts. */
function measurement(id: string, from: number[], to: number[]): unknown {
  const [dx, dy, dz] = [0, 1, 2].map((axis) => (to[axis] ?? 0) - (from[axis] ?? 0)) as [number, number, number];
  const tenth = (metres: number): number => Math.round(metres * 1000) / 10;
  return {
    id,
    from: { at: from, what: "prop:lantern" },
    to: { at: to, what: "member:cy.wrist_r" },
    cm: tenth(Math.hypot(dx, dy, dz)),
    horizontalCm: tenth(Math.hypot(dx, dz)),
    verticalCm: tenth(dy),
  };
}

const M1 = measurement("m1", [0.8, 1.13, -1.4], [1.1, 1.53, -1.0]);
const M2 = measurement("m2", [0, 0, 0], [0, 0.5, 0]);

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

async function run(input: unknown, answers: Record<string, unknown>) {
  const lab = fakeLab({ ...labAnswers(), ...answers });
  const result = await handleToolRequest("lab_measure", input, fakeContext(lab.port));
  return { result, text: textOf(result), calls: lab.calls };
}

describe("lab_measure", () => {
  test("gives the distance between two ends with its parts, through measureBetween of the lab", async () => {
    const { result, text, calls } = await run(
      { from: "prop:lantern", to: "member:cy.wrist_r" },
      { measureBetween: () => M1 },
    );
    expect(result.isError).toBeUndefined();
    expect(calls.find((item) => item.call === "measureBetween")?.args).toEqual(["prop:lantern", "member:cy.wrist_r"]);
    // 0.3, 0.4 and 0.4 m: 64.0 cm, 50.0 cm on the floor, 40.0 cm up.
    expect(text).toContain(
      "m1: 64.0 cm (horizontal 50.0, vertical +40.0) from prop:lantern (0.8, 1.13, -1.4) to member:cy.wrist_r (1.1, 1.53, -1)",
    );
    expect(text).toContain("The lab shows it in the frame");
  });

  test("gives the measurements of the owner without ends, the last first", async () => {
    const { text } = await run({}, { measurements: [M1, M2] });
    expect(text.split("\n")[0]).toBe(`Last: ${measureLine(M2)}`);
    expect(text).toContain(`  ${measureLine(M1)}`);
    const none = await run({}, { measurements: [] });
    expect(none.text).toContain("No measurements in the lab. The owner presses M");
    const half = await run({ from: "table" }, {});
    expect(half.text).toContain("Give both ends");
  });

  test("gives the error of the lab for a bad end", async () => {
    const { result, text } = await run(
      { from: "shelf", to: "table" },
      { measureBetween: new Error('"shelf" is not an end.') },
    );
    expect(result.isError).toBe(true);
    expect(text).toContain('"shelf" is not an end.');
  });
});

describe("the measurements in the context packet", () => {
  test("lists the last three measurements, and nothing for a lab without them", async () => {
    const packet = await buildPacket(fakeContext(fakeLab({ ...labAnswers(), measurements: [M1, M2] }).port));
    expect(packet.text).toContain("Measurements in the frame (lab_measure):");
    expect(packet.text).toContain(`  ${measureLine(M1)}`);
    const before = await buildPacket(fakeContext(fakeLab(labAnswers()).port));
    expect(before.text).not.toContain("Measurements in the frame");
    const many = measureBlock([M1, M2, M1, M2]);
    expect(many[0]).toBe("Measurements in the frame (the last 3 of 4) (lab_measure):");
    expect(many).toHaveLength(4);
  });
});
