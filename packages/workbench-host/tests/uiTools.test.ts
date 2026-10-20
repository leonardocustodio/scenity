// SPDX-License-Identifier: Apache-2.0
// The UI tools: each tool calls the visible frame with its bridge call. `ui_reveal` sends only the parts of the
// request with a value and gives what the window did. `ui_highlight` reports a missing part.
import { describe, expect, test } from "bun:test";
import { handleToolRequest } from "../src/tools/index";
import type { SurfacePort } from "../src/tools/context";
import { fakeContext } from "./fakeLab";

function page() {
  const calls: { name: string; args: readonly unknown[] }[] = [];
  const answers: Record<string, unknown> = {
    "ui.reveal": { done: ["panel:inspector", "field:environment.exposure"], missing: [] },
    "ui.highlight": false,
    "ui.state": {
      workspace: "layout",
      panels: ["scene.view", "inspector"],
      activePanel: "inspector",
      selection: [],
      scene: "scenes/main.scene.json",
      time: null,
      theme: "dark",
    },
  };
  const port: SurfacePort = {
    call(name, args = []) {
      calls.push({ name, args });
      return Promise.resolve(answers[name]);
    },
  };
  return { port, calls };
}

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string =>
  result.content.map((block) => block.text ?? "").join("\n");

describe("the UI tools", () => {
  test("ui_reveal shows the exposure field in one call", async () => {
    const { port, calls } = page();
    const input = { field: "environment.exposure", text: "Turn this down" };
    const text = textOf(await handleToolRequest("ui_reveal", input, fakeContext(port)));
    expect(calls).toEqual([{ name: "ui.reveal", args: [input] }]);
    expect(text).toBe("Done: panel:inspector, field:environment.exposure.");
  });

  test("ui_state words the state; ui_highlight reports a part that is not in the window", async () => {
    const { port } = page();
    expect(textOf(await handleToolRequest("ui_state", {}, fakeContext(port)))).toContain("Workspace: layout");
    expect(textOf(await handleToolRequest("ui_highlight", { target: "nothing" }, fakeContext(port)))).toBe(
      'ui_highlight: no part "nothing" in the window now.',
    );
  });
});
