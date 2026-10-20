// SPDX-License-Identifier: Apache-2.0
// The empty states of the panels. Each panel of the editor window tells what to do next and has a prompt for the agent.
// "Ask the agent" puts the prompt in the agent panel when the window has an agent.
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EmptyState from "../../src/studio/shell/EmptyState.vue";
import { emptyStateOf } from "../../src/studio/shell/emptyStates";
import { CORE_PANELS } from "../../src/studio/shell/panels";
import { SHELL_KEY } from "../../src/studio/shell/shell";
import { editorI18n } from "../../src/texts";

const has = (id: string): boolean => editorI18n().format(id) !== id;

describe("the empty states of the panels", () => {
  it("lists each panel with its text and its prompt", () => {
    const rows = CORE_PANELS.map((panel) => ({ panel: panel.id, ...emptyStateOf(panel.id) }));
    expect(rows).toHaveLength(CORE_PANELS.length);
    for (const row of rows) {
      expect(has(row.text), `${row.panel}: ${row.text}`).toBe(true);
      expect(has(row.prompt), `${row.panel}: ${row.prompt}`).toBe(true);
    }
  });

  it("shows the text, and Ask the agent only when the window has an agent", async () => {
    const calls: [string, unknown][] = [];
    const plain = mount(EmptyState, { props: { panel: "hierarchy" }, global: { plugins: [editorI18n().plugin] } });
    expect(plain.text()).toContain("The scene has no entities");
    expect(plain.find("[data-testid=empty-ask]").exists()).toBe(false);
    plain.unmount();
    const commands = {
      has: (id: string) => id === "agent.ask",
      execute: (id: string, args: unknown) => {
        calls.push([id, args]);
        return Promise.resolve();
      },
    };
    const studio = mount(EmptyState, {
      props: { panel: "jobs", text: "No job ran yet." },
      global: { plugins: [editorI18n().plugin], provide: { [SHELL_KEY as symbol]: { commands } } },
    });
    expect(studio.text()).toContain("No job ran yet.");
    await studio.get("[data-testid=empty-ask]").trigger("click");
    expect(calls).toEqual([["agent.ask", { prompt: editorI18n().format("empty-prompt-jobs") }]]);
    studio.unmount();
  });
});
