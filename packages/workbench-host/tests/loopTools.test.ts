// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the loop tools (`lab_sheet`, `workbench_after` and `workbench_run`) against fake ports.
 */
import { describe, expect, test } from "bun:test";
import { handleToolRequest } from "../src/tools/index";
import { makeToolContext, type AfterView, type LoopPorts, type SurfacePort } from "../src/tools/context";
import { itemStep, laneLines, sheetTimes } from "../src/tools/sheet";
import type { ToolResult } from "../src/tools/kit";
import { fakeLab, labAnswers, REPO_ROOT, type FakeCall } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SHEET = {
  width: 1280,
  height: 640,
  mime: "image/webp",
  data: "UklGRiQAAABXRUJQ",
  simMs: [5000, 5250],
  take: "greet",
  cameras: ["side"],
  lanes: {
    from: 5000,
    to: 9000,
    rows: [{ member: "jo", parts: [{ label: "wave_hello", family: "wave", from: 5000, to: 9000, clip: true }] }],
  },
};

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`)).join("\n");
}

function context(ports: { lab: SurfacePort; shadow: SurfacePort }, loop: LoopPorts = {}) {
  return makeToolContext({
    surface: (id) => (id === "shadow" ? ports.shadow : ports.lab),
    checkout: REPO_ROOT,
    ...loop,
  });
}

describe("lab_sheet", () => {
  test("the window times and the item step are those of labs sheet", () => {
    expect(sheetTimes(13000, 14000, 250)).toEqual([13000, 13250, 13500, 13750, 14000]);
    expect(itemStep(5000, 9000)).toBe(267);
    expect(() => sheetTimes(10, 0, 5)).toThrow("forward");
  });

  test("an item gives the window and the camera; the sheet comes from the shadow frame only", async () => {
    const visible = fakeLab();
    const shadow = fakeLab({ ...labAnswers(), sheet: SHEET });
    const result = await handleToolRequest(
      "lab_sheet",
      { item: "clip_wave_hello" },
      context({ lab: visible.port, shadow: shadow.port }),
    );
    expect(result.isError).toBeUndefined();
    expect(visible.calls).toEqual([]);
    expect(shadow.calls.map((item: FakeCall) => item.call)).toEqual(["open", "item", "sheet"]);
    const args = shadow.calls[2]?.args[0] as { times: number[]; cameras: string[]; maxWidth: number };
    expect(args.times).toHaveLength(15);
    expect(args.times[0]).toBe(5000);
    expect(args.cameras).toEqual(["side"]);
    expect(args.maxWidth).toBe(1280);
    const text = textOf(result);
    expect(text).toContain("Sheet of take greet · 15 times 5000–");
    expect(text).toContain("jo: wave_hello 5000–9000");
    expect(result.content.at(-1)).toEqual({ type: "image", data: SHEET.data, mimeType: "image/webp" });
  });

  test("a window without an item and too many cells are errors", async () => {
    const lab = fakeLab({ sheet: SHEET });
    const ports = { lab: lab.port, shadow: lab.port };
    expect((await handleToolRequest("lab_sheet", {}, context(ports))).isError).toBe(true);
    const many = await handleToolRequest("lab_sheet", { from: 0, to: 20000, step: 100 }, context(ports));
    expect(textOf(many)).toContain("at most 64 cells");
  });

  test("the lanes text names a missing lane", () => {
    expect(laneLines(null)).toEqual(["Lanes: none (panel events after the take, or a view track)."]);
  });
});

describe("workbench_after", () => {
  // The host keeps the bytes. Base64 occurs only in the tool result.
  const bytes = new Uint8Array(Buffer.from("iVBORw0KGgo=", "base64"));
  const capture = { simMs: 6350, width: 640, height: 400, mime: "image/png" as const, bytes };
  const view: AfterView = {
    turn: 2,
    files: ["plugins/demo/room/src/model/families/wave.ts"],
    url: "http://127.0.0.1:1/?take=greet&t=6350",
    after: capture,
    reloaded: true,
    applied: true,
    error: null,
  };

  test("gives the after picture of the turn with the reload flag (a PNG of WebKit too)", async () => {
    const lab = fakeLab();
    const widths: (number | undefined)[] = [];
    const ctx = context(
      { lab: lab.port, shadow: lab.port },
      {
        after: (width) => {
          widths.push(width);
          return Promise.resolve(view);
        },
      },
    );
    const result = await handleToolRequest("workbench_after", { width: 640 }, ctx);
    expect(widths).toEqual([640]);
    expect(textOf(result)).toContain("applied with a page reload");
    expect(result.content.at(-1)).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
  });

  test("no turn and no host give errors", async () => {
    const lab = fakeLab();
    const none = context({ lab: lab.port, shadow: lab.port }, { after: () => Promise.resolve(null) });
    expect(textOf(await handleToolRequest("workbench_after", {}, none))).toContain("no turn yet");
    const bare = context({ lab: lab.port, shadow: lab.port });
    expect(textOf(await handleToolRequest("workbench_after", {}, bare))).toContain("no turn capture");
  });
});

describe("workbench_run", () => {
  test("runs a command of the allowlist and gives the summary, the folder and the images", async () => {
    const lab = fakeLab();
    const seen: { command: string; args: readonly string[] }[] = [];
    const ctx = context(
      { lab: lab.port, shadow: lab.port },
      {
        run: (command, args) => {
          seen.push({ command, args });
          return Promise.resolve({
            run: "r1",
            command: "motion",
            args: ["greet", "--out", "/o"],
            checkout: REPO_ROOT,
            status: "failed",
            code: 1,
            started: "2026-10-12T15:00:00.000Z",
            ended: "2026-10-12T15:01:00.000Z",
            gpu: true,
            summary: "FAIL hands.toTarget",
            outDir: "/o",
            images: ["/o/a.png"],
            line: "bun run labs motion",
          });
        },
      },
    );
    const result = await handleToolRequest("workbench_run", { command: "motion", args: ["greet"] }, ctx);
    expect(seen).toEqual([{ command: "motion", args: ["greet"] }]);
    const text = textOf(result);
    expect(text).toContain("labs motion greet --out /o · failed (exit 1)");
    expect(text).toContain("/o/a.png");
  });

  test("a command outside the allowlist is refused before a run", async () => {
    const lab = fakeLab();
    const ctx = context({ lab: lab.port, shadow: lab.port }, { run: () => Promise.reject(new Error("no")) });
    for (const command of ["tune-apply", "perf", "rm"]) {
      const result = await handleToolRequest("workbench_run", { command }, ctx);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("bad input");
    }
  });
});
