// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the readers of the dock: the unified diff and the Markdown of a review pack, and the command line of a
 * run.
 */
import { describe, expect, test } from "vitest";
import { parseDiff } from "../../src/dock/diff";
import { parseInline, parseMarkdown, resolveImage } from "../../src/dock/markdown";
import { runLine } from "../../src/dock/useRuns";

describe("the diff reader", () => {
  test("it gives the files, the kinds of the lines and the counts", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "diff --git a/b.md b/b.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/b.md",
      "@@ -0,0 +1 @@",
      "+hello",
      "",
    ].join("\n");
    const files = parseDiff(patch);
    expect(files.map((file) => [file.path, file.added, file.removed])).toEqual([
      ["a.ts", 1, 1],
      ["b.md", 1, 0],
    ]);
    expect(files[0]?.lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "del",
      "add",
    ]);
  });
});

describe("the Markdown reader", () => {
  test("it reads headings, tables, lists, code and paragraphs", () => {
    const blocks = parseMarkdown(
      "# Title\n\nSome *text* and `code`.\nSame paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n1. first\n\n```\nx = 1\n```\n\n---\n",
    );
    expect(blocks.map((block) => block.t)).toEqual(["heading", "paragraph", "table", "list", "list", "code", "rule"]);
    expect(blocks[1]).toEqual({
      t: "paragraph",
      c: [
        { t: "text", v: "Some " },
        { t: "em", c: [{ t: "text", v: "text" }] },
        { t: "text", v: " and " },
        { t: "code", v: "code" },
        { t: "text", v: ". Same paragraph." },
      ],
    });
    expect(blocks[3]).toMatchObject({ t: "list", ordered: false });
    expect(blocks[4]).toMatchObject({ t: "list", ordered: true });
  });

  test("it reads images and links, and keeps snake_case words as text", () => {
    expect(parseInline("![sheet](a/b.png) [doc](https://x.org) clip_wave_hello")).toEqual([
      { t: "image", src: "a/b.png", alt: "sheet" },
      { t: "text", v: " " },
      { t: "link", href: "https://x.org", c: [{ t: "text", v: "doc" }] },
      { t: "text", v: " clip_wave_hello" },
    ]);
  });

  test("an image path is relative to the folder of the file", () => {
    expect(resolveImage("/out/review", "frames/a.png")).toBe("/out/review/frames/a.png");
    expect(resolveImage("/out/review", "./a.png")).toBe("/out/review/a.png");
    expect(resolveImage("/out/review", "../b.png")).toBe("/out/b.png");
    expect(resolveImage("/out/review", "/abs/c.png")).toBe("/abs/c.png");
  });
});

describe("the run line", () => {
  test("it hides the output folder that the host adds", () => {
    expect(runLine({ command: "sheet", args: ["--take", "greet", "--out", "/x/y"] })).toBe("labs sheet --take greet");
  });
});
