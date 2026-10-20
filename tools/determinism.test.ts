// SPDX-License-Identifier: Apache-2.0
// The determinism lint.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkText, determinismFiles, scan } from "./determinism";

const temp = mkdtempSync(join(tmpdir(), "scenity-determinism-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function put(path: string, text: string): void {
  mkdirSync(dirname(join(temp, path)), { recursive: true });
  writeFileSync(join(temp, path), text);
}

describe("checkText", () => {
  test("finds the wall clock, random numbers with no seed and timers", () => {
    const text = [
      "const a = Date.now();",
      "const b = performance.now();",
      "const c = new Date();",
      "const d = Math.random();",
      "crypto.getRandomValues(bytes);",
      "setTimeout(() => undefined, 1);",
      "setInterval(tick, 10);",
    ].join("\n");
    expect(checkText(text, "a.ts").map((finding) => finding.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("finds a loop over a Set or a Map, and accepts a marked line", () => {
    const text = [
      "const seen = new Set<string>();",
      "const byId: Map<string, number> = load();",
      "for (const id of seen) use(id);",
      "for (const [key, value] of byId.entries()) use(key, value);",
      "itemSet.forEach(use);",
      "for (const id of seen) use(id); // determinism: ordered",
      "// determinism: ordered",
      "this.#indexMap.forEach(use);",
      "for (const id of [...seen].sort()) use(id);",
      "for (const item of list) use(item);",
    ].join("\n");
    expect(checkText(text, "a.ts").map((finding) => finding.line)).toEqual([3, 4, 5]);
  });

  test("does not read comments and strings", () => {
    const text = ["// no Date.now() here", "/* Math.random() */", 'const text = "setTimeout(x)";'].join("\n");
    expect(checkText(text, "a.ts")).toEqual([]);
  });
});

describe("scan", () => {
  test("fails on Date.now in a systems folder of a plugin, and reads only sim and systems", () => {
    put("plugins/demo/part/src/systems/clock.ts", "export const now = () => Date.now();\n");
    put("plugins/demo/part/src/sim/walk.ts", "export const step = () => Math.random();\n");
    put("plugins/demo/part/src/view/page.ts", "export const now = () => Date.now();\n");
    put("samples/demo/plugins/local/systems/ok.ts", "export const two = 2;\n");
    expect(determinismFiles(temp)).toEqual([
      "plugins/demo/part/src/sim/walk.ts",
      "plugins/demo/part/src/systems/clock.ts",
      "samples/demo/plugins/local/systems/ok.ts",
    ]);
    expect(scan(temp).map((finding) => `${finding.path}:${String(finding.line)}`)).toEqual([
      "plugins/demo/part/src/sim/walk.ts:1",
      "plugins/demo/part/src/systems/clock.ts:1",
    ]);
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "determinism.ts"), "--root", temp]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("Date.now reads the wall clock");
  });

  test("passes on the repo", () => {
    expect(determinismFiles().length).toBeGreaterThan(0);
    expect(scan()).toEqual([]);
  });
});
