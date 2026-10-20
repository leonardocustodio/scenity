// SPDX-License-Identifier: Apache-2.0
// The docs of Scenity Studio: the quickstart has no terminal step after `scenity studio`,
// and each link and picture of the studio pages names a file of the repository.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** The shell blocks of a Markdown page, in order. */
const shellBlocks = (text: string): string[] =>
  Array.from(text.matchAll(/```(?:sh|bash|console|shell)\n([\s\S]*?)```/g), (match) => match[1] ?? "");

describe("the docs of the studio", () => {
  test("the quickstart has no terminal step after scenity studio", () => {
    const blocks = shellBlocks(read("docs/quickstart.md"));
    const start = blocks.findIndex((block) => /^scenity studio\s*$/m.test(block));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(blocks.slice(start + 1)).toEqual([]);
  });

  test("each link and picture of the studio pages names a file", () => {
    for (const page of ["docs/studio.md", "docs/quickstart.md", "docs/README.md"]) {
      const text = read(page);
      for (const match of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = match[1] ?? "";
        if (/^[a-z]+:/.test(target)) continue;
        expect({ page, target, found: existsSync(join(ROOT, dirname(page), target)) }).toEqual({
          page,
          target,
          found: true,
        });
      }
    }
  });

  test("the docs index names the studio, and the workbench page as one that retires", () => {
    const index = read("docs/README.md");
    expect(index).toContain("[studio.md](studio.md)");
    expect(index).toMatch(/\[workbench\.md\]\(workbench\.md\)[^\n]*retires/);
  });
});
