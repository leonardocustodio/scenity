// SPDX-License-Identifier: Apache-2.0
// The lines of the studio in the system prompt of an agent turn: the mode, and "Show me how".
import { describe, expect, test } from "bun:test";
import { studioPrompt } from "../src/agents/claude";
import type { TurnInput } from "../src/agents/driver";

const session = (mode: "ask" | "review" | "auto"): TurnInput["session"] =>
  ({ name: "One", mode, planFirst: false }) as unknown as TurnInput["session"];

describe("studioPrompt", () => {
  test("names the mode of the session", () => {
    expect(studioPrompt({ session: session("ask"), instructions: "" })).toContain("Ask mode");
    expect(studioPrompt({ session: session("review"), instructions: "" })).toContain("Review mode");
  });

  test("tells the agent to show a person how with ui_highlight, and names the tutorials", () => {
    const text = studioPrompt({ session: session("review"), instructions: "" });
    expect(text).toContain("ui_highlight");
    expect(text).toContain("Help → Tutorials");
  });
});
