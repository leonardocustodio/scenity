// SPDX-License-Identifier: Apache-2.0
// The texts of the core agent tools name no part of the lab page: the descriptions of the tools and of their inputs,
// and the result lines of the commands, the edits and the tune values. A lab host gives its own words. For example, the
// workbench host gives the `lab_*` tools and `labTuneLines`.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { STUDIO_TOOLS } from "../src/index";
import { commandLines, editLines } from "../src/edit";
import { tuneLines } from "../src/tunes";

const LAB_WORDS = /\blabs?\b|\blab_[a-z]+|tune-apply|tune tab|\ba take\b/i;

describe("the words of the core tools", () => {
  test("no tool description and no input description names the lab", () => {
    for (const tool of STUDIO_TOOLS) {
      const input = JSON.stringify(z.toJSONSchema(tool.input as z.ZodType));
      expect({ tool: tool.name, words: LAB_WORDS.exec(`${tool.description} ${input}`)?.[0] ?? null }).toEqual({
        tool: tool.name,
        words: null,
      });
    }
  });

  test("the result lines of a command, an edit and the tune values name no lab", () => {
    const listing = { commands: [{ id: "entity.move", title: "Move", kind: "edit", args: {}, available: true }] };
    const run = { outcome: "applied", command: "entity.move", title: "Move", ops: [], step: true, tunes: { "a.b": 2 } };
    const proposal = { outcome: "proposed", command: "entity.move", title: "Move", proposal: "p1", ops: [] };
    const lines = [
      ...commandLines(listing),
      ...editLines(run, null),
      ...editLines(proposal, null),
      ...tuneLines(Object.fromEntries(Array.from({ length: 20 }, (_, at) => [`t.${String(at)}`, at]))),
    ].join("\n");
    expect(LAB_WORDS.exec(lines)?.[0] ?? null).toBeNull();
    expect(lines).toContain("the editor");
  });
});
