// SPDX-License-Identifier: Apache-2.0
// The marks of the files of the agents in the Project window: the files of the turns of each session (an undone turn
// gives none). The page reads them again at the start and the end of a turn. An asset takes the mark of its record,
// else the mark of its source.
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import type { AgentSessionView } from "../../src/scene/agent/agentClient";
import { agentFileMarks, markOf, startTurnFileMarks } from "../../src/scene/agent/turnFileMarks";

const session = (running: boolean) =>
  ({ id: "s1", name: "Codex", colour: "agent-2", running }) as unknown as AgentSessionView;

describe("the marks of the files of the agents", () => {
  it("mark the files of the turns that stay, and read them again at the end of a turn", async () => {
    const sessions = shallowRef<readonly AgentSessionView[]>([session(true)]);
    let turns = [{ turn: 1, files: ["notes/a.md"], undone: true }];
    const stop = startTurnFileMarks({ sessions }, { turns: () => Promise.resolve({ turns }) });
    await flushPromises();
    expect(agentFileMarks.value.size).toBe(0);
    turns = [
      { turn: 1, files: ["notes/a.md"], undone: true },
      { turn: 2, files: ["assets/shelf.gltf.meta.json"], undone: false },
    ];
    sessions.value = [session(false)];
    await flushPromises();
    expect(markOf([null, "assets/shelf.gltf"])).toBeNull();
    expect(markOf(["assets/shelf.gltf.meta.json", "assets/shelf.gltf"])).toEqual({
      session: "s1",
      name: "Codex",
      colour: "agent-2",
      turn: 2,
    });
    stop();
  });
});
