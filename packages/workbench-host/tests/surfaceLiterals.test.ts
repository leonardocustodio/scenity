// SPDX-License-Identifier: Apache-2.0
/**
 * The surfaces come from data. The source of the host and of the workbench page never
 * names a surface: it asks for a capability (`hasCapability`, `surfaceWith`) or reads an ID from the project. This
 * test fails on a `"lab"` string in that source. The IDs of the built-in project are data of the host plugin
 * (src/plugins.ts), and the tests and fixtures can use them.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
/** The source folders of the host and of the page. */
const FOLDERS = ["packages/workbench-host/src", "apps/workbench/src"];
/** A string literal (double quotes, single quotes or a template) whose whole text is the name of the lab surface. */
const SURFACE_LITERAL = /(["'`])lab\1/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
  });
}

/** The `file:line` of each line with the literal. */
function surfaceLiterals(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, at) => (SURFACE_LITERAL.test(line) ? [`${relative(ROOT, file)}:${String(at + 1)}`] : [])),
  );
}

describe("no surface name in the host and page code", () => {
  test("the pattern finds the literal in each quote form and leaves other words alone", () => {
    expect(
      ['relay.call("lab", "visible")', "id === 'lab'", "surface=`lab`"].every((line) => SURFACE_LITERAL.test(line)),
    ).toBe(true);
    expect(
      ['"labs"', '"lab-visible"', "labPanel", '"scripts/lab/pool"', "\"lab'"].some((line) =>
        SURFACE_LITERAL.test(line),
      ),
    ).toBe(false);
  });

  test("a search for the lab literal finds none", () => {
    const files = FOLDERS.flatMap((folder) => sourceFiles(join(ROOT, folder)));
    expect(files.length).toBeGreaterThan(100);
    expect(surfaceLiterals(files)).toEqual([]);
  });
});
