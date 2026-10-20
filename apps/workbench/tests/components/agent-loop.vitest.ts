// SPDX-License-Identifier: Apache-2.0
// The agent loop in the page. An `agent.turn` event shows the before and after without an action of the owner (side by
// side, then the slider). The Stop gate toggle asks the host.
import type { EventPayload, EventType, StopGateState } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, shallowRef } from "vue";
import { useAgentLoop, type LoopClient } from "../../src/claude/useAgentLoop";
import type { TerminalClient } from "../../src/claude/useTerminal";
import ClaudeColumn from "../../src/layout/ClaudeColumn.vue";
import { fakePictures, pictureIdOf } from "./fakePictures";

const OFF: StopGateState = { on: false, take: null, last: null };

function fakeClient() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const requests: { type: string; params: unknown }[] = [];
  let gate: StopGateState = OFF;
  const client = {
    on<T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener as (payload: unknown) => void);
      listeners.set(type, list);
      return () => undefined;
    },
    request(type: string, params: { on?: boolean }) {
      requests.push({ type, params });
      if (typeof params.on === "boolean") gate = { ...gate, on: params.on };
      return Promise.resolve(gate);
    },
    onHello: () => () => undefined,
  } as unknown as TerminalClient;
  const emit = <T extends EventType>(type: T, payload: EventPayload<T>): void => {
    for (const listener of listeners.get(type) ?? []) listener(payload);
  };
  return { client, emit, requests };
}

const TURN: EventPayload<"agent.turn"> = {
  session: "s1",
  turn: 2,
  files: ["src/model/families/wave.ts"],
  url: "http://127.0.0.1:5400/?take=greet&t=6350",
  // References of the picture store. The page shows them as object URLs.
  before: { id: pictureIdOf("before"), simMs: 6350, width: 640, height: 400, mime: "image/webp" },
  after: { id: pictureIdOf("after"), simMs: 6350, width: 640, height: 400, mime: "image/png" },
  reloaded: true,
};

function mountColumn() {
  const fake = fakeClient();
  const Host = defineComponent({
    setup() {
      const client = shallowRef<LoopClient | null>(fake.client);
      const loop = useAgentLoop(client, null);
      return () => h(ClaudeColumn, { client: fake.client, checkout: null, loop });
    },
  });
  return { wrapper: mount(Host), ...fake };
}

describe("the agent loop in the Claude column", () => {
  it("shows the before and after of an agent.turn event, side by side and under a slider", async () => {
    const { wrapper, emit } = mountColumn();
    expect(wrapper.find('[data-testid="before-after"]').exists()).toBe(false);
    const pictures = fakePictures();
    emit("agent.turn", TURN);
    await flushPromises();
    expect(wrapper.find('[data-testid="before-after"]').text()).toContain("Turn 2 · reloaded");
    expect(wrapper.find('[data-testid="before-after-before"]').attributes("src")).toBe(
      `blob:picture-${pictureIdOf("before")}`,
    );
    expect(wrapper.find('[data-testid="before-after-after"]').attributes("src")).toBe(
      `blob:picture-${pictureIdOf("after")}`,
    );
    expect(wrapper.html()).not.toContain("data:image");
    pictures.stop();
    expect(wrapper.find('[data-testid="before-after-files"]').text()).toContain("families/wave.ts");
    await wrapper.find('[data-testid="before-after-slider"]').trigger("click");
    const range = wrapper.find('[data-testid="before-after-range"]');
    await range.setValue("30");
    const after = wrapper.find('[data-testid="before-after-stack"] img:last-child');
    expect(after.attributes("style")).toContain("inset(0 0 0 30%)");
  });

  it("an after picture that failed says so", async () => {
    const { wrapper, emit } = mountColumn();
    emit("agent.turn", { ...TURN, after: null });
    await nextTick();
    expect(wrapper.text()).toContain("No after picture yet");
  });

  it("the Stop gate toggle asks the host and shows the last verdict", async () => {
    const { wrapper, emit, requests } = mountColumn();
    await nextTick();
    expect(requests[0]).toEqual({ type: "agent.setStopGate", params: {} });
    await wrapper.find('[data-testid="stop-gate-toggle"]').setValue(true);
    await nextTick();
    expect(requests.at(-1)).toEqual({ type: "agent.setStopGate", params: { on: true } });
    emit("agent.stopGate", {
      gate: {
        on: true,
        take: "greet",
        last: { pass: false, summary: "FAIL", at: "2026-10-12T15:04:00.000Z", refused: true },
      },
    });
    await nextTick();
    expect(wrapper.find('[data-testid="stop-gate-verdict"]').text()).toContain("Sequence greet fails: Claude goes on");
  });
});
