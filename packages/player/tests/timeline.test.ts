// SPDX-License-Identifier: Apache-2.0
// The page side of the time line: the event keys of a play step, and the plugin input of a simulation plugin
// (its `project` output at the clock time goes to the core with each clock change).
import { describe, expect, test } from "bun:test";
import { defineSimulation, type SequenceDocument } from "@scenity/scene/sequence";
import { createPlayerWith } from "../src/player";
import { emptyLog, fakeCanvas, fakeDeps, sampleFetch } from "./kit";

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "count",
  scene: "main",
  duration: 3000,
  markers: { half: 1500 },
  tracks: [
    { kind: "event", entity: "robot", keys: [{ t: 1000, name: "beep", args: { level: 2 } }] },
    {
      kind: "action",
      keys: [
        { t: 500, action: "counter.add" },
        { t: 2000, action: "counter.add" },
      ],
    },
  ],
};

const counter = defineSimulation<{ readonly count: number }, { readonly count: number; readonly t: number }>({
  id: "counter",
  stateSchema: { safeParse: (value) => ({ success: true, data: value as { count: number } }) },
  initial: () => ({ count: 0 }),
  reduce: (state) => ({ count: state.count + 1 }),
  settle: (state) => state,
  project: (state, t) => ({ count: state.count, t }),
});

const URL_OF = "http://player.test/projects/characters/sequences/count.sequence.json";

function open() {
  const log = emptyLog();
  const fetch = sampleFetch({ [URL_OF]: JSON.stringify(SEQUENCE) });
  const { deps, manual } = fakeDeps(log, { fetch });
  const player = createPlayerWith(
    fakeCanvas(),
    { project: "/projects/characters/scenity.project.json", sequence: "sequences/count.sequence.json" },
    deps,
  );
  return { player, log, manual };
}

describe("the time line of the player", () => {
  test("a play step gives the markers and the event keys in time order", async () => {
    const { player, manual } = open();
    await player.ready;
    const crossed: unknown[] = [];
    player.on("marker", (detail) => crossed.push(["marker", detail]));
    player.on("event", (detail) => crossed.push(["event", detail]));
    player.play();
    manual.advance(1600);
    expect(crossed).toEqual([
      ["event", { name: "beep", t: 1000, entity: "robot", args: { level: 2 } }],
      ["marker", { name: "half", t: 1500 }],
    ]);
  });

  test("the simulation input goes to the core at the load, at each seek and at each play step", async () => {
    const log = emptyLog();
    const fetch = sampleFetch({ [URL_OF]: JSON.stringify(SEQUENCE) });
    const { deps, manual } = fakeDeps(log, { fetch });
    const player = createPlayerWith(
      fakeCanvas(),
      {
        project: "/projects/characters/scenity.project.json",
        sequence: "sequences/count.sequence.json",
        simulation: counter,
      },
      deps,
    );
    await player.ready;
    // The input message is the input map by plugin ID, so the core gives each plugin its own input.
    expect(log.inputs).toEqual([{ counter: { count: 0, t: 0 } }]);
    await player.seek(2500);
    expect(log.inputs.at(-1)).toEqual({ counter: { count: 2, t: 2500 } });
    await player.seek(600);
    player.play();
    manual.advance(100);
    expect(log.inputs.at(-1)).toEqual({ counter: { count: 1, t: 700 } });
  });
});
