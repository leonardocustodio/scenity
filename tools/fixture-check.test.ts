// SPDX-License-Identifier: Apache-2.0
// The fixture check: no engine test names a fixture name of the room of CodeBlue. The tests build the texts
// from the list of the tool, so this file names none of them.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countHits } from "./domain-words";
import { FIXTURE_NAMES, fixturePattern, isTestFile, scanFixtures, textHits } from "./fixture-check";

/** The first fixture name of the list: a plain word part. */
const NAME = FIXTURE_NAMES[0]?.pattern ?? "";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A temporary repository with the given files (path → text). */
function repo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "fixture-check-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the fixture check", () => {
  test("the list is small and every pattern is a plain word part with no domain word", () => {
    expect(FIXTURE_NAMES.length).toBeLessThanOrEqual(12);
    expect(NAME).toMatch(/^[a-z]+$/);
    for (const name of FIXTURE_NAMES) {
      expect(() => new RegExp(name.pattern)).not.toThrow();
      expect(countHits(`${name.pattern} ${name.from}`)).toBe(0);
    }
  });

  test("knows a test file by its folder or its name", () => {
    expect(isTestFile("packages/scene/tests/ops.test.ts")).toBe(true);
    expect(isTestFile("apps/editor/tests/gallery/showroom.spec.ts")).toBe(true);
    expect(isTestFile("packages/labs-platform/src/testing/suite.ts")).toBe(true);
    expect(isTestFile("apps/editor/src/core/compare.vitest.ts")).toBe(true);
    expect(isTestFile("packages/scene/src/ops.ts")).toBe(false);
  });

  test("finds a whole word part with any case, and not a part of a longer word", () => {
    const hits = (text: string) => textHits("a.test.ts", text).map((hit) => hit.text);
    expect(hits(`?take=${NAME}&t=0`)).toEqual([NAME]);
    expect(hits(`const take${NAME.toUpperCase()[0] ?? ""}${NAME.slice(1)} = 1;`)).toEqual([NAME]);
    expect(hits(`"${NAME}_take"`)).toEqual([NAME]);
    expect(hits(`"${NAME}ed" and "un${NAME}"`)).toEqual([]);
    expect(textHits("a.test.ts", `x\n${NAME}`)[0]?.line).toBe(2);
  });

  test("a list of names gives one pattern", () => {
    const pattern = fixturePattern([{ pattern: "lamp_[0-9]+", from: "a test" }]);
    expect(textHits("a.test.ts", "lamp_12 and lamp_x", pattern).map((hit) => hit.text)).toEqual(["lamp_12"]);
  });

  test("reads every source file, and the test files only with tests", () => {
    const root = repo({
      "packages/a/tests/a.test.ts": `const take = "${NAME}";\n`,
      "plugins/b/runtime/tests/fixtures/b.json": `{ "take": "${NAME}" }\n`,
      "packages/a/src/a.ts": `// ${NAME}\n`,
      "packages/a/tests/clean.test.ts": 'const take = "greet";\n',
      "packages/a/node_modules/x/tests/x.test.ts": `"${NAME}"\n`,
    });
    expect(scanFixtures(root, { tests: true }).map((hit) => hit.path)).toEqual([
      "packages/a/tests/a.test.ts",
      "plugins/b/runtime/tests/fixtures/b.json",
    ]);
    expect(
      scanFixtures(root)
        .map((hit) => hit.path)
        .sort(),
    ).toEqual(["packages/a/src/a.ts", "packages/a/tests/a.test.ts", "plugins/b/runtime/tests/fixtures/b.json"]);
  });

  test("finds a member prefix, a second take and a host tool of the room", () => {
    const pattern = (index: number): RegExp => fixturePattern(FIXTURE_NAMES.slice(index, index + 1));
    const hits = (text: string, index: number) => textHits("a.ts", text, pattern(index)).map((hit) => hit.text);
    const member = FIXTURE_NAMES.findIndex((name) => name.from.startsWith("the member IDs"));
    const prefix = FIXTURE_NAMES[member]?.pattern.slice(0, 4) ?? "";
    expect(hits(`id.replace(/^${prefix}/, "")`, member)).toEqual([prefix]);
    const second = FIXTURE_NAMES.findIndex((name) => name.from === "the second take of the room");
    expect(hits('{ kind: "take", take: "parade" }', second)).toEqual([]);
    expect(hits("const swapped = take;", second)).toEqual([]);
    const tools = FIXTURE_NAMES.findIndex((name) => name.from === "the host tools of the room");
    expect(hits("lab_frame and lab_sheet", tools)).toEqual([]);
  });

  test("the files of this checkout name no fixture name of the room", () => {
    expect(scanFixtures()).toEqual([]);
  });
});
