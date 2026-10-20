// SPDX-License-Identifier: Apache-2.0
// The turns over time in the Claude column. After a page load, the panel lists the saved turns of the host. It shows
// the newest turn with its two-row sheet (before and after over the turn window). It follows a new turn, and it shows
// an earlier turn on a pick.
import type { EventPayload, EventType, PictureRef, SavedTurn, TurnPictures } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, shallowRef } from "vue";
import { useAgentLoop, type LoopClient } from "../../src/claude/useAgentLoop";
import type { TerminalClient } from "../../src/claude/useTerminal";
import { upsertTurn } from "../../src/claude/useTurnHistory";
import ClaudeColumn from "../../src/layout/ClaudeColumn.vue";
import { fakePictures, pictureIdOf, type FakePictures } from "./fakePictures";

/** A picture reference of the host. The page shows it as an object URL. */
function picture(label: string): PictureRef {
  return { id: pictureIdOf(label), simMs: 6350, width: 640, height: 400, mime: "image/webp" };
}

/** The object URL of the fake picture source for a label. */
function blob(label: string): string {
  return `blob:picture-${pictureIdOf(label)}`;
}

let pictures: FakePictures;
beforeEach(() => {
  pictures = fakePictures();
});
afterEach(() => {
  pictures.stop();
});

function saved(turn: number, started: string, patch: Partial<SavedTurn> = {}): SavedTurn {
  return {
    ...{ session: "s1", turn, prompt: `prompt ${String(turn)}`, started, files: ["a.ts"], url: null },
    ...{ reloaded: false, applied: true, error: null, pictures: ["before", "after", "beforeSheet", "afterSheet"] },
    window: { from: 4350, to: 8350, times: [4350, 5683, 7017, 8350], camera: "top", source: "time" },
    ...patch,
  };
}

const TURNS = [saved(3, "2026-10-12T22:10:00.000Z", { reloaded: true }), saved(2, "2026-10-12T22:00:00.000Z")];

function picturesOf(turn: SavedTurn): TurnPictures {
  const n = String(turn.turn);
  return {
    turn,
    before: picture(`B${n}`),
    after: picture(`A${n}`),
    beforeSheet: picture(`SB${n}`),
    afterSheet: picture(`SA${n}`),
  };
}

function fakeClient(list: SavedTurn[]) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const requests: { type: string; params: Record<string, unknown> }[] = [];
  const client = {
    on<T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as (payload: unknown) => void]);
      return () => undefined;
    },
    request(type: string, params: Record<string, unknown>) {
      requests.push({ type, params });
      if (type === "agent.turnList") return Promise.resolve({ turns: list });
      if (type === "agent.turnPictures") {
        const turn = list.find((item) => item.session === params.session && item.turn === params.turn);
        return turn === undefined ? Promise.reject(new Error("no turn")) : Promise.resolve(picturesOf(turn));
      }
      return Promise.resolve({ on: false, take: null, last: null });
    },
    onHello: () => () => undefined,
  } as unknown as TerminalClient;
  const emit = <T extends EventType>(type: T, payload: EventPayload<T>): void => {
    for (const listener of listeners.get(type) ?? []) listener(payload);
  };
  return { client, emit, requests };
}

function mountColumn(list: SavedTurn[]) {
  const fake = fakeClient(list);
  const Host = defineComponent({
    setup() {
      const loop = useAgentLoop(shallowRef<LoopClient | null>(fake.client), null);
      return () => h(ClaudeColumn, { client: fake.client, checkout: null, loop });
    },
  });
  return { wrapper: mount(Host), ...fake };
}

describe("the turns over time", () => {
  it("lists the saved turns after a load and shows the newest with its two-row sheet", async () => {
    const { wrapper, requests } = mountColumn(TURNS);
    await flushPromises();
    expect(requests.map((item) => item.type)).toEqual(["agent.setStopGate", "agent.turnList", "agent.turnPictures"]);
    const options = wrapper.findAll('[data-testid="turn-history"] option').map((option) => option.text());
    expect(options).toEqual(["The newest turn", "Turn 3 · 1 file · reloaded · prompt 3", "Turn 2 · 1 file · prompt 2"]);
    expect(wrapper.find('[data-testid="before-after-title"]').text()).toBe("Turn 3 · reloaded");
    expect(wrapper.find('[data-testid="before-after-after"]').attributes("src")).toBe(blob("A3"));
    expect(wrapper.find('[data-testid="turn-sheet-before"]').attributes("src")).toBe(blob("SB3"));
    expect(wrapper.find('[data-testid="turn-sheet-after"]').attributes("src")).toBe(blob("SA3"));
    expect(wrapper.find('[data-testid="turn-sheets-window"]').text()).toBe("4.35–8.35 s · ±2 s round the turn · top");
  });

  it("an earlier turn on a pick; the newest again on the first option", async () => {
    const { wrapper, requests } = mountColumn(TURNS);
    await flushPromises();
    await wrapper.find('[data-testid="turn-history"]').setValue("s1 2");
    await flushPromises();
    expect(requests.at(-1)).toEqual({ type: "agent.turnPictures", params: { session: "s1", turn: 2 } });
    expect(wrapper.find('[data-testid="before-after-title"]').text()).toBe("Turn 2");
    expect(wrapper.find('[data-testid="turn-sheet-after"]').attributes("src")).toBe(blob("SA2"));
    await wrapper.find('[data-testid="turn-history"]').setValue("");
    await flushPromises();
    expect(wrapper.find('[data-testid="before-after-title"]').text()).toBe("Turn 3 · reloaded");
  });

  it("follows a new turn: the live event first, then its saved pictures and sheets", async () => {
    const list = [...TURNS];
    const { wrapper, emit } = mountColumn(list);
    await flushPromises();
    emit("agent.turn", {
      ...{ session: "s1", turn: 4, files: ["b.ts"], url: null, reloaded: false },
      ...{ before: picture("B4"), after: picture("A4") },
    });
    await nextTick();
    expect(wrapper.find('[data-testid="before-after-title"]').text()).toBe("Turn 4");
    // The live event has no window: no sheets show until the saved turn comes.
    expect(wrapper.find('[data-testid="turn-sheets"]').exists()).toBe(false);
    const fourth = saved(4, "2026-10-12T22:20:00.000Z", { files: ["b.ts"] });
    list.unshift(fourth);
    emit("agent.turnSaved", { turn: fourth });
    await flushPromises();
    expect(wrapper.find('[data-testid="turn-sheet-after"]').attributes("src")).toBe(blob("SA4"));
    expect(wrapper.findAll('[data-testid="turn-history"] option')).toHaveLength(4);
  });

  it("upsertTurn replaces a turn and keeps the newest first", () => {
    const changed = { ...TURNS[1]!, prompt: "again" };
    expect(upsertTurn(TURNS, changed).map((item) => [item.turn, item.prompt])).toEqual([
      [3, "prompt 3"],
      [2, "again"],
    ]);
  });
});
