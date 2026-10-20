// SPDX-License-Identifier: Apache-2.0
// The API of the player over fakes: the load of a project (the scene, the sequence, the manifest), the
// renderer plan, the play, pause and seek state, the events, the end of a sequence and the dispose.
import { describe, expect, test } from "bun:test";
import { createPlayerWith } from "../src/player";
import type { Player, PlayerEventName } from "../src/types";
import { emptyLog, fakeCanvas, fakeClient, fakeDeps } from "./kit";

const CHARACTERS = "/projects/characters/scenity.project.json";
const SHOWROOM = "/projects/showroom/scenity.project.json";

/** Record each event of a player in order. */
function record(player: Player) {
  const events: [PlayerEventName, unknown][] = [];
  const names: PlayerEventName[] = ["ready", "play", "pause", "seek", "timeupdate", "ended", "marker", "error"];
  for (const name of names) player.on(name, (detail) => events.push([name, detail]));
  return events;
}

describe("the load of the player", () => {
  test("the showroom: its built manifest, its first scene, no sequence, the worker", async () => {
    const log = emptyLog();
    const { deps } = fakeDeps(log);
    const player = createPlayerWith(fakeCanvas(), { project: SHOWROOM, camera: "front" }, deps);
    const events = record(player);
    await player.ready;
    expect(player.state).toBe("ready");
    expect(player.renderer).toBe("worker");
    expect(log.options?.workerUrl).toBe("/assets/sceneWorker.js");
    expect(log.options?.surface).toEqual({ width: 640, height: 360, dpr: 2 });
    const [load] = log.loads;
    expect(load?.documents?.scene.id).toBe("main");
    expect(load?.documents?.sequence).toBeUndefined();
    expect(load?.tier).toBe("high");
    // The built manifest: each file URL is in the build folder of the project.
    expect(load?.manifest?.records.length).toBeGreaterThan(0);
    expect(Object.values(load?.files ?? {})[0]).toStartWith("http://player.test/projects/showroom/build/");
    expect(log.cameras).toEqual(["front"]);
    expect(player.duration).toBe(0);
    expect(player.cameras()).toEqual(["front", "top"]);
    expect(events[0]?.[0]).toBe("ready");
  });

  test("the characters: the first sequence of the scene, and the dev asset index when the project has no build", async () => {
    const log = emptyLog();
    const index = JSON.stringify({ A1: { path: "assets/robot.glb", kind: "model" } });
    const fetch = (await import("./kit")).sampleFetch({
      "http://player.test/projects/characters/assets.index.json": index,
    });
    const { deps } = fakeDeps(log, { fetch });
    const player = createPlayerWith(fakeCanvas(), { project: CHARACTERS }, deps);
    await player.ready;
    const [load] = log.loads;
    expect(load?.documents?.sequence?.id).toBe("walk-wave");
    expect(load?.files).toEqual({ "assets/robot.glb": "http://player.test/projects/characters/assets/robot.glb" });
    expect(player.duration).toBe(9000);
    expect(player.time).toBe(0);
  });

  test("a scene with no such camera fails the load with the error event", async () => {
    const log = emptyLog();
    const { deps } = fakeDeps(log);
    const player = createPlayerWith(fakeCanvas(), { project: SHOWROOM, camera: "nope" }, deps);
    const events = record(player);
    const error = await player.ready.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(String(error)).toContain('the scene has no camera "nope"');
    expect(player.state).toBe("failed");
    expect(events).toEqual([["error", { reason: 'the scene has no camera "nope"' }]]);
  });

  test("the renderer plan: webgpu on the main thread, auto with no worker asks the chooser", async () => {
    for (const [options, workerUrl, backend] of [
      [{ backend: "webgpu" as const }, null, "webgpu"],
      [{ backend: "webgl" as const }, "/assets/sceneWorker.js", undefined],
      [{ worker: false }, null, "webgpu"],
      [{ worker: false, backend: "webgl" as const }, null, undefined],
    ] as const) {
      const log = emptyLog();
      const { deps } = fakeDeps(log);
      await createPlayerWith(fakeCanvas(), { project: SHOWROOM, ...options }, deps).ready;
      expect(log.options?.workerUrl ?? null).toBe(workerUrl);
      expect(log.options?.backend?.backend).toBe(backend);
    }
  });

  test("a container gets a canvas of the player, and dispose stops the client and the sounds", async () => {
    const log = emptyLog();
    let made = 0;
    let removed = 0;
    const { deps, manual } = fakeDeps(log, {
      makeCanvas: () => {
        made += 1;
        return fakeCanvas(() => (removed += 1));
      },
      createClient: fakeClient(log, ["front"], "main"),
    });
    const container = { tagName: "DIV" } as unknown as HTMLElement;
    const player = createPlayerWith(container, { project: CHARACTERS, sequence: null }, deps);
    await player.ready;
    expect(made).toBe(1);
    expect(player.renderer).toBe("main");
    player.dispose();
    expect(player.state).toBe("disposed");
    expect(log.disposed).toBe(true);
    expect(manual.audio.disposed).toBe(true);
    expect(removed).toBe(1);
  });
});

describe("the time of the player", () => {
  async function characters(options: Record<string, unknown> = {}) {
    const log = emptyLog();
    const { deps, manual } = fakeDeps(log);
    const player = createPlayerWith(fakeCanvas(), { project: CHARACTERS, ...options }, deps);
    const events = record(player);
    await player.ready;
    return { player, events, log, manual };
  }

  test("play, the time of the wall clock, pause, and the clock anchor of each change", async () => {
    const { player, events, log, manual } = await characters();
    expect(player.playing).toBe(false);
    const inputs = log.inputs.length;
    player.play();
    expect(player.playing).toBe(true);
    // A play sends the clock anchor (a plugin input message with a new seek count) and resumes the audio context.
    expect(log.inputs.length).toBe(inputs + 1);
    expect(log.options?.getClockEpoch?.()).toBe(1);
    expect(manual.audio.resumes).toBe(1);
    manual.advance(250);
    expect(player.time).toBe(250);
    manual.advance(250);
    player.pause();
    expect(player.playing).toBe(false);
    expect(player.time).toBe(500);
    manual.advance(1000);
    expect(player.time).toBe(500);
    expect(events.map(([name]) => name)).toEqual(["ready", "play", "timeupdate", "marker", "timeupdate", "pause"]);
    expect(events[3]).toEqual(["marker", { name: "idle", t: 500 }]);
    expect(log.options?.getSimMs()).toBe(500);
  });

  test("a seek stands at the time, waits for its frame and gives the seek event", async () => {
    const { player, events, log, manual } = await characters();
    player.play();
    manual.advance(100);
    const patches = log.patches;
    await player.seek(2500);
    expect(log.patches).toBe(patches + 1);
    expect(player.playing).toBe(false);
    expect(player.time).toBe(2500);
    expect(log.times.at(-1)).toBe(2500);
    expect(events.slice(-2)).toEqual([
      ["pause", { t: 2500 }],
      ["seek", { t: 2500 }],
    ]);
    // A seek clamps to the time line.
    await player.seek(99_999);
    expect(player.time).toBe(9000);
    await player.seek(-5);
    expect(player.time).toBe(0);
  });

  test("autoplay and the end of a sequence with no loop: the pause and the ended events", async () => {
    const { player, events, manual } = await characters({ autoplay: true, start: 8900 });
    expect(player.playing).toBe(true);
    manual.advance(50);
    manual.advance(200);
    expect(player.playing).toBe(false);
    expect(player.time).toBe(9000);
    expect(events.slice(-2)).toEqual([
      ["pause", { t: 9000 }],
      ["ended", { t: 9000 }],
    ]);
    // A play at the end plays from 0.
    player.play();
    expect(player.time).toBe(0);
  });

  test("a loop plays again from 0 and gives the markers after the wrap", async () => {
    const { player, events, manual } = await characters({ loop: true, start: 7900 });
    player.play();
    manual.advance(200);
    manual.advance(1000);
    expect(player.playing).toBe(true);
    // The time line has duration + 1 times (0..9000): 7900 + 1200 is 99 after the wrap.
    expect(player.time).toBe(99);
    const markers = events.filter(([name]) => name === "marker").map(([, detail]) => detail);
    expect(markers).toEqual([{ name: "rest", t: 8000 }]);
    manual.advance(500);
    expect(events.filter(([name]) => name === "marker").at(-1)?.[1]).toEqual({ name: "idle", t: 500 });
  });

  test("a listener that the result of `on` removes gets no more events", async () => {
    const { player, manual } = await characters();
    const times: number[] = [];
    const off = player.on("timeupdate", ({ t }) => times.push(t));
    player.play();
    manual.advance(10);
    off();
    manual.advance(10);
    expect(times).toEqual([10]);
  });

  test("setCamera gives the camera event, and false for a camera that the scene does not have", async () => {
    const { player } = await characters();
    const names: (string | null)[] = [];
    player.on("camera", ({ name }) => names.push(name));
    expect(await player.setCamera("top")).toBe(true);
    expect(await player.setCamera("side")).toBe(false);
    expect(names).toEqual(["top"]);
  });
});
