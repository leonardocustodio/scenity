// SPDX-License-Identifier: Apache-2.0
/**
 * The core tool `scene_check`. It runs `scenity check` for the project of the open checkout with no browser, and it
 * gives the table and the JSON report. The showroom passes, and a failed block rule fails. A folder with no project
 * file gives a tool error. A started host gives the tool its project folder.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckReport } from "@scenity/cli/check";
import { startHost } from "../src/host";
import { HOST_PATHS, TOKEN_HEADER } from "../src/protocol";
import { handleToolRequest } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";
import { cleanup, fakeCommand, tempDir } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SHOWROOM = resolve(import.meta.dir, "../../../samples/showroom");
const made: string[] = [];
afterAll(() => cleanup(...made));

/** Run `scene_check` for a project folder. */
function check(projectDir: string, input: unknown = {}): Promise<ToolResult> {
  return handleToolRequest("scene_check", input, { ...fakeContext(fakeLab(labAnswers()).port), projectDir });
}

/** The table text and the JSON report of a result. */
function parts(result: ToolResult): { table: string; report: CheckReport } {
  const [table, json] = result.content.map((block) => (block.type === "text" ? block.text : ""));
  return { table: table ?? "", report: JSON.parse(json ?? "{}") as CheckReport };
}

/** A project whose block rule keeps a box within 2 m of the origin; the box stands at x. */
function boxProject(x: number): string {
  const dir = tempDir("scene-check");
  made.push(dir);
  mkdirSync(join(dir, "scenes"));
  const rule = {
    id: "box.near",
    metric: "distance",
    args: { from: "entity:box", to: [0, 0, 0] },
    max: 2,
    level: "block",
  };
  const box = { parent: null, index: 0, components: { transform: { position: [x, 0, 0] } } };
  const scene = { format: "scenity.scene/1", id: "main", entities: { box }, rules: [rule] };
  writeFileSync(join(dir, "scenes/main.scene.json"), JSON.stringify(scene));
  const project = { format: "scenity.project/1", id: "box", name: "Box", scenes: ["scenes/main.scene.json"] };
  writeFileSync(join(dir, "scenity.project.json"), JSON.stringify(project));
  return dir;
}

describe("the tool scene_check", () => {
  test("the showroom passes: a table and the JSON report of each rule", async () => {
    const result = await check(SHOWROOM, { scene: "scenes/main.scene.json" });
    expect(result.isError).toBeUndefined();
    const { table, report } = parts(result);
    expect(table).toContain("showroom.lanternOnTable");
    expect(table).toContain("passed: 5 rules");
    expect(report.passed).toBe(true);
    expect(report.rows.map((row) => row.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  test("a failed block rule fails the report; bad input and a folder with no project give tool errors", async () => {
    const { table, report } = parts(await check(boxProject(3)));
    expect(report.passed).toBe(false);
    expect(table).toContain("FAIL block");
    expect(parts(await check(boxProject(1))).report.passed).toBe(true);
    const both = await check(SHOWROOM, { scene: "a.scene.json", sequence: "b.sequence.json" });
    expect(both.isError).toBe(true);
    const bare = tempDir("scene-check-bare");
    made.push(bare);
    const none = await check(bare);
    expect(none.isError).toBe(true);
    expect(parts(none).table).toContain("has no scenity.project.json");
  });

  test("a started host gives the tool the project folder of the checkout", async () => {
    const parent = tempDir("scene-check-host");
    const state = tempDir("scene-check-host-state");
    made.push(parent, state);
    const dir = join(parent, "showroom");
    cpSync(SHOWROOM, dir, { recursive: true });
    const host = await startHost({ checkout: dir, stateDir: state, serverCommand: fakeCommand, watch: false });
    try {
      const response = await fetch(`${host.endpoint.origin}${HOST_PATHS.tools}scene_check`, {
        method: "POST",
        headers: { [TOKEN_HEADER]: host.endpoint.token, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = (await response.json()) as ToolResult;
      const { report } = parts(result);
      expect(report.project).toBe("showroom");
      expect(report.dir).toBe(dir);
      expect(report.passed).toBe(true);
    } finally {
      await host.stop();
    }
  });
});
