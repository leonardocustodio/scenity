// SPDX-License-Identifier: Apache-2.0
// The input of the play mode in the player over fakes. With `input: true`, a key on the canvas gives an input event
// at the clock time. The core gets it through the link of the client, and the handle records it. A pointer press
// picks the entity. With a recording, the player replays its events and takes no live input. A new core gets all
// the events again.
import { describe, expect, test } from "bun:test";
import type { InputEvent, InputRecording } from "@scenity/scene/sequence";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import type { DocumentClientOptions } from "@scenity/runtime/documentClient";
import { defineInputMap } from "@scenity/runtime/inputMap";
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { withPlayerInput } from "../src/input";
import { createPlayerWith } from "../src/player";
import type { PlayerOptions } from "../src/types";
import { emptyLog, fakeCanvas, fakeClient, fakeDeps } from "./kit";

const CHARACTERS = "/projects/characters/scenity.project.json";

const demo = defineRuntimePlugin({
  id: "demo",
  inputMap: defineInputMap({
    keys: { "demo.faster": ["ArrowUp"] },
    pointer: { "demo.toggle": { component: "animator" } },
  }),
});

/** The input messages of the core, and the listeners of the canvas by event type. */
interface InputSetup {
  readonly sent: { events: readonly InputEvent[]; replace: boolean }[];
  readonly listeners: Map<string, ((event: unknown) => void)[]>;
  link(): void;
}

function setup(options: PlayerOptions) {
  const log = emptyLog();
  const sent: InputSetup["sent"] = [];
  const listeners: InputSetup["listeners"] = new Map();
  const core: Partial<DocumentCore> = {
    setInputs: (events, replace) => {
      sent.push({ events, replace: replace ?? false });
    },
  };
  let link: DocumentClientOptions["link"];
  const canvas = Object.assign(fakeCanvas(), {
    tabIndex: -1,
    focus: () => undefined,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: () => undefined,
  }) as unknown as HTMLCanvasElement;
  const client = fakeClient(log);
  const { deps, manual } = fakeDeps(log, {
    loadPlugins: () => Promise.resolve([demo]),
    createClient: (target, clientOptions) => {
      link = clientOptions.link;
      return client(target, clientOptions).then((made) => {
        clientOptions.link?.({ mode: "main", core: core as DocumentCore });
        return Object.assign(made, {
          pickEntity: () =>
            Promise.resolve({ entity: "robot", component: null, target: null, point: [0, 1, 0], distance: 2 }),
        });
      });
    },
  });
  const player = withPlayerInput(options, deps, (wrapped) => createPlayerWith(canvas, options, wrapped));
  const fire = (type: string, event: Record<string, unknown>): void => {
    for (const listener of listeners.get(type) ?? []) listener({ preventDefault: () => undefined, ...event });
  };
  const relink = (): void => link?.({ mode: "main", core: core as DocumentCore });
  return { player, manual, sent, fire, relink, canvas };
}

/** Wait for the promises of the player (the input maps load after the first frame). */
async function settle(): Promise<void> {
  // The input session is a lazy chunk: its import takes more than one turn of the event loop.
  for (let index = 0; index < 5; index += 1) await new Promise((done) => setTimeout(done, 5));
}

describe("the input of the play mode in the player", () => {
  test("a key and a pointer press give input events at the clock time, and the handle records them", async () => {
    const { player, manual, sent, fire, canvas } = setup({ project: CHARACTERS, input: true });
    await player.ready;
    await settle();
    expect(canvas.tabIndex).toBe(0);
    // A live session removes no event of the core (the events of `send` of the embed API stay).
    expect(sent).toEqual([]);
    await player.seek(1500);
    fire("keydown", { code: "ArrowUp", repeat: false });
    fire("keydown", { code: "ArrowUp", repeat: true });
    fire("keydown", { code: "KeyQ", repeat: false });
    player.play();
    manual.advance(250);
    fire("keyup", { code: "ArrowUp" });
    fire("pointerdown", { button: 0, pointerId: 1, clientX: 110, clientY: 220 });
    await settle();
    const events = sent.flatMap((message) => (message.replace ? [] : message.events));
    expect(events).toEqual([
      { t: 1500, kind: "press", action: "demo.faster" },
      { t: 1750, kind: "release", action: "demo.faster" },
      { t: 1750, kind: "press", action: "demo.toggle", entity: "robot", point: [0, 1, 0] },
    ]);
    const recording = player.inputRecording?.();
    expect(recording?.format).toBe("scenity.input/1");
    expect(recording?.scene).toBe("main");
    expect(recording?.events).toEqual(events);
  });

  test("a recording replays its events with no live input, and a new core gets them again", async () => {
    const replay: InputRecording = {
      format: "scenity.input/1",
      id: "take",
      scene: "main",
      events: [{ t: 400, kind: "press", action: "demo.faster" }],
    };
    const { player, sent, fire, relink } = setup({ project: CHARACTERS, input: replay });
    await player.ready;
    await settle();
    expect(sent.at(-1)).toEqual({ events: replay.events, replace: false });
    fire("keydown", { code: "ArrowUp", repeat: false });
    expect(sent).toHaveLength(1);
    relink();
    expect(sent.at(-1)).toEqual({ events: replay.events, replace: false });
    expect(player.inputRecording?.()?.events).toEqual(replay.events);
  });

  test("a player with no input option has no input part", async () => {
    const { player, sent } = setup({ project: CHARACTERS });
    await player.ready;
    await settle();
    expect(sent).toEqual([]);
    expect("inputRecording" in player).toBe(false);
  });
});
