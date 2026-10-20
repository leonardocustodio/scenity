// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the onion skin options of the frame tools. `lab_frame { onion: true }` stops the clock and shows the onion
 * skin of the lab. It captures with the onion skin (`{ onion: true }`, the capture mode). Then it restores the onion
 * skin of the lab. It never reads the frame index. `lab_sheet { onion: true }` asks the sheet of the
 * shadow frame for the onion skin, and it does not read the index either.
 */
import { describe, expect, test } from "bun:test";
import { handleToolRequest } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const BEFORE = { on: false, step: 250, count: 2, capture: false };

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`)).join("\n");
}

describe("the onion skin of lab_frame", () => {
  test("captures with the onion skin on a stopped clock and puts the onion skin of the lab back", async () => {
    const lab = fakeLab({
      ...labAnswers(),
      onion: (args: readonly unknown[]) => ({ ...BEFORE, ...(args[0] as object), before: BEFORE }),
    });
    const result = await handleToolRequest(
      "lab_frame",
      { t: 6350, width: 640, onion: true, onionStep: 200, onionCount: 3 },
      fakeContext(lab.port),
    );
    expect(result.isError).toBeUndefined();
    const calls = lab.calls.map((item) => item.call);
    expect(calls.slice(calls.indexOf("measure"))).toEqual(["measure", "pause", "onion", "capture", "onion", "url"]);
    const onions = lab.calls.filter((item) => item.call === "onion").map((item) => item.args);
    expect(onions).toEqual([[{ on: true, step: 200, count: 3 }], [BEFORE]]);
    expect(lab.calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400, { onion: true }]);
    expect(textOf(result)).toContain("Onion skin: 3 copies on each side, 200 ms apart (blue before, orange after).");
  });

  test("keeps the usual capture of a frame without onion", async () => {
    const lab = fakeLab();
    await handleToolRequest("lab_frame", { t: 6350, width: 640 }, fakeContext(lab.port));
    expect(lab.calls.some((item) => item.call === "onion")).toBe(false);
    expect(lab.calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400]);
  });
});

describe("the hide of lab_frame", () => {
  test("asks the capture for the solo and hide of its pane only with hidden: true, and not from the index", async () => {
    const lab = fakeLab();
    await handleToolRequest("lab_frame", { t: 6350, width: 640, pane: 1, hidden: true }, fakeContext(lab.port));
    expect(lab.calls.find((item) => item.call === "capture")?.args).toEqual([
      640,
      null,
      400,
      { pane: 1, hidden: true },
    ]);
    const plain = fakeLab();
    await handleToolRequest("lab_frame", { t: 6350, width: 640, hidden: false }, fakeContext(plain.port));
    expect(plain.calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400]);
  });
});

describe("the onion skin of lab_sheet", () => {
  test("asks the sheet of the shadow frame for the onion skin", async () => {
    const lab = fakeLab();
    const shadow = fakeLab();
    const ctx = { ...fakeContext(lab.port), surface: (id: string) => (id === "shadow" ? shadow.port : lab.port) };
    await handleToolRequest("lab_sheet", { from: 6000, to: 7000, step: 500, onion: true }, ctx);
    const sheet = shadow.calls.find((item) => item.call === "sheet") ?? lab.calls.find((item) => item.call === "sheet");
    expect(sheet?.args[0]).toMatchObject({ times: [6000, 6500, 7000], onion: true });
  });
});
