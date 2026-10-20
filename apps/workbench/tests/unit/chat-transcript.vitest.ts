// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests of the readers of the chat: the fold of the transcript and the approval diff.
 */
import { describe, expect, test } from "vitest";
import { answerText, approvalPatch, bashCall, inputSummary, questionsOf } from "../../src/claude/approval";
import { costText, foldMessages } from "../../src/claude/transcript";

describe("foldMessages", () => {
  test("folds the init, a tool call with its error result and an error result", () => {
    const transcript = foldMessages([
      {
        type: "system",
        subtype: "init",
        session_id: "s-1",
        model: "claude-haiku-5-5",
        apiKeySource: "ANTHROPIC_API_KEY",
        claude_code_version: "2.1.284",
      },
      {
        type: "assistant",
        uuid: "a",
        message: { content: [{ type: "tool_use", id: "t", name: "Read", input: { file_path: "/a.ts" } }] },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "No file." }] },
      },
      {
        type: "result",
        subtype: "error_max_budget_usd",
        total_cost_usd: 0.05,
        duration_ms: 10,
        num_turns: 3,
        errors: ["budget"],
      },
      { type: "user", message: { role: "user", content: "a synthetic message" } },
    ]);
    expect(transcript.entries.map((entry) => entry.kind)).toEqual(["system", "tool", "result"]);
    expect(transcript.entries[0]).toMatchObject({
      text: "Session s-1 · claude-haiku-5-5 · credential ANTHROPIC_API_KEY · Claude Code 2.1.284",
    });
    expect(transcript.entries[1]).toMatchObject({ outcome: { isError: true, texts: ["No file."], images: [] } });
    expect(transcript.entries[2]).toMatchObject({ subtype: "error_max_budget_usd", errors: ["budget"] });
  });

  test("gives the cost as an estimate", () => {
    expect(costText(0.01234)).toBe("$0.0123 (estimate)");
    expect(costText(2.5)).toBe("$2.50 (estimate)");
  });
});

describe("the approval readers", () => {
  test("an Edit, a MultiEdit and a Write give a unified diff", () => {
    expect(approvalPatch("Edit", { file_path: "a.ts", old_string: "x\ny", new_string: "z" })).toBe(
      ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ edit @@", "-x", "-y", "+z"].join("\n"),
    );
    expect(approvalPatch("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }] })).toContain(
      "@@ edit 1 @@\n-a\n+b",
    );
    expect(approvalPatch("Write", { file_path: "n.ts", content: "one\ntwo\n" })).toContain(
      "@@ new content @@\n+one\n+two",
    );
    expect(approvalPatch("Bash", { command: "ls" })).toBeNull();
  });

  test("Bash, the questions and the summary", () => {
    expect(bashCall("Bash", { command: "bun test", description: "Run the tests" })).toEqual({
      command: "bun test",
      description: "Run the tests",
    });
    expect(questionsOf({ questions: [{ question: "Q?", options: [{ label: "A" }] }] })).toEqual([
      { question: "Q?", header: "", options: [{ label: "A", description: "" }], multiSelect: false },
    ]);
    expect(answerText(["A", "B"], " other ")).toBe("A, B, other");
    expect(inputSummary("Edit", { file_path: "/repo/a.ts" })).toBe("/repo/a.ts");
  });
});
