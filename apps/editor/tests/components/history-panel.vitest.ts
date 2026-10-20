// SPDX-License-Identifier: Apache-2.0
// The History panel: the steps with their actors, the steps of one agent turn as a group, the current step and the
// undone steps. Also a click that goes to a step in one action.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryStep } from "@scenity/editor-core";
import HistoryPanel from "../../src/scene/history/HistoryPanel.vue";
import { goToCommand, historyGroups, historyRows, watchHistory } from "../../src/scene/history/historyRows";

afterEach(() => {
  document.body.innerHTML = "";
});

const agent = (turn: number) => ({ kind: "agent" as const, session: "s1", name: "Chairs", colour: "agent-2", turn });
const STEPS: HistoryStep[] = [
  { values: {}, label: null },
  { values: {}, label: { id: "e1", title: "Move Lamp" } },
  { values: {}, label: { id: "e2", title: "Add Chair", actor: agent(1) } },
  { values: {}, label: { id: "e3", title: "Move Chair", actor: agent(1) } },
  { values: {}, label: { id: "e4", title: "Name Chair", actor: agent(2) } },
];

/** A history of the steps with the current step at `index`. */
function fakeHistory(index: number) {
  const state = { index };
  const listeners = new Set<() => void>();
  return {
    state,
    steps: () => ({ index: state.index, steps: STEPS }),
    listen: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    move: (next: number) => {
      state.index = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("the History panel", () => {
  it("gives the steps with their actors, and the steps of one agent turn as a group", () => {
    const rows = historyRows(fakeHistory(3));
    expect(rows.map((row) => [row.title, row.set, row.current, row.undone])).toEqual([
      ["The scene as it opened", null, false, false],
      ["Move Lamp", null, false, false],
      ["Add Chair", "s1#1", false, false],
      ["Move Chair", "s1#1", true, false],
      ["Name Chair", "s1#2", false, true],
    ]);
    expect(historyGroups(rows).map((group) => [group.set, group.rows.length])).toEqual([
      [null, 1],
      [null, 1],
      ["s1#1", 2],
      ["s1#2", 1],
    ]);
  });

  it("follows the history and goes to a step on a click", async () => {
    const history = fakeHistory(4);
    const watched = watchHistory(history);
    const went: number[] = [];
    mount(HistoryPanel, {
      props: { rows: () => watched.rows.value, goTo: (index: number) => went.push(index) },
      attachTo: document.body,
    });
    const step = (index: number) => document.querySelector<HTMLButtonElement>(`[data-index="${String(index)}"]`);
    expect(step(4)?.getAttribute("aria-current")).toBe("step");
    expect(document.querySelectorAll('[data-testid="history-group-head"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="history-group-head"]')?.textContent).toContain("Chairs: turn 1");
    step(1)?.click();
    expect(went).toEqual([1]);
    history.move(1);
    await flushPromises();
    expect(step(1)?.getAttribute("aria-current")).toBe("step");
    expect(step(3)?.hasAttribute("data-undone")).toBe(true);
    watched.stop();
  });

  it("has a command for a script or an agent; a step out of the history is an error", () => {
    const went: number[] = [];
    const command = goToCommand((index) => {
      went.push(index);
      return index < 5;
    });
    expect(command).toMatchObject({ id: "history.goTo", agents: true });
    void command.run({ step: 2 });
    expect(went).toEqual([2]);
    expect(() => command.run({ step: 9 })).toThrow("No step 9 to go to.");
  });
});
