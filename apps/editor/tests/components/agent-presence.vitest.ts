// SPDX-License-Identifier: Apache-2.0
// The presence of the agents. The page keeps the newest presence of each session. It keeps the pins of the entities
// that a turn works on, and the camera of its frame for 3 s. It also gets the attention of the person: a toast when a
// turn ends, and a toast and a fact of the bell while a session waits.
import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { AgentSessionView } from "../../src/scene/agent/agentClient";
import { watchAttention } from "../../src/scene/agent/agentPanel";
import type { AgentStore } from "../../src/scene/agent/agentStore";
import {
  CAMERA_SHOW_MS,
  clearPresences,
  newestRunning,
  pagePresences,
  receivePresence,
  workingOn,
} from "../../src/scene/agent/presence";
import { presencePins } from "../../src/scene/viewport/changePins";
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";

afterEach(() => clearPresences());

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    lamp: { name: "Lamp", parent: null, index: 0, components: { transform: { position: [0, 0, -5] } } },
    eye: { name: "Eye", parent: null, index: 1, components: { transform: { position: [2, 0, -5] }, camera: {} } },
  },
} as unknown as SceneDocument;
const VIEW = {
  position: [0, 0, 0] as [number, number, number],
  forward: [0, 0, -1] as [number, number, number],
  fov: 60,
};

function presence(session: string, running: boolean, more: Record<string, unknown> = {}) {
  return {
    type: "agent.presence",
    session: { id: session, name: `S ${session}`, colour: "agent-3" },
    running,
    ...more,
  };
}

describe("the presence of the agents", () => {
  it("keeps the newest presence of each session and the entities of a running turn", () => {
    receivePresence(presence("s1", true, { activity: "scene_query (1)", entities: ["lamp"], camera: "eye" }), 1000);
    receivePresence(presence("s2", false, { entities: ["eye"] }), 2000);
    receivePresence({ session: {} });
    expect(pagePresences().size).toBe(2);
    expect(workingOn("lamp")?.session.name).toBe("S s1");
    expect(workingOn("eye")).toBeNull();
    expect(newestRunning()?.activity).toBe("scene_query (1)");
    receivePresence(presence("s1", true, { entities: [], camera: "eye" }), 5000);
    // The camera did not change: its time stays.
    expect(pagePresences().get("s1")?.cameraAt).toBe(1000);
  });

  it("gives the pins of the working entities and the camera of a frame for 3 s", () => {
    receivePresence(presence("s1", true, { entities: ["lamp"], camera: "eye" }), 1000);
    const size = { width: 800, height: 600 };
    const now = presencePins(pagePresences().values(), DOC, VIEW, size, 1500);
    expect(now.pins).toMatchObject([{ id: "lamp", change: "working", colour: "var(--sc-color-studio-agent-3)" }]);
    expect(now.frustums).toHaveLength(1);
    expect(presencePins(pagePresences().values(), DOC, VIEW, size, 1000 + CAMERA_SHOW_MS + 1).frustums).toEqual([]);
  });

  it("tells the person when a turn ends and while a session waits", async () => {
    const sessions = shallowRef<readonly AgentSessionView[]>([]);
    const notices = new WindowNotices();
    const status = new WindowStatus();
    watchAttention({ sessions } as unknown as AgentStore, { notices, status });
    const view = (patch: Partial<AgentSessionView>) => ({
      id: "s1",
      name: "Chairs",
      running: true,
      waiting: false,
      ...patch,
    });
    sessions.value = [view({}) as AgentSessionView];
    await flushPromises();
    sessions.value = [view({ waiting: true }) as AgentSessionView];
    await flushPromises();
    expect(status.values.bell.map((fact) => fact.text)).toEqual(["Chairs waits for you."]);
    sessions.value = [view({ running: false }) as AgentSessionView];
    await flushPromises();
    expect(status.values.bell).toEqual([]);
    expect(notices.state.toasts.map((toast) => toast.title)).toEqual([
      "Chairs waits for you.",
      "Chairs ended its turn.",
    ]);
  });
});
