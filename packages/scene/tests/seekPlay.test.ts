// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createEvaluator, type FrameState, type SequenceDocument } from "../src/index";
import { deepFreeze, registry, seeded } from "./helpers";
import { doorsPlugin, randomSequence, shopPlugin, testScene } from "./sequenceKit";

const simulations = [doorsPlugin, shopPlugin];
const BOXES = 6;
const scene = deepFreeze(testScene(BOXES));

/** A frame with an empty `fired` part: the keys of a play step depend on the step, not only on t. */
function stateOf(frame: FrameState): FrameState {
  return { ...frame, fired: [] };
}

function make(sequence: SequenceDocument, checkpointMs?: number) {
  return createEvaluator({ scene, sequence, registry, simulations, ...(checkpointMs ? { checkpointMs } : {}) });
}

describe("seek equals play", () => {
  const random = seeded(2026);
  const sequence = deepFreeze(randomSequence(random, 60000, BOXES));
  const times = Array.from({ length: 1000 }, () => Math.floor(random() * (sequence.duration + 1)));
  const ordered = [...new Set(times)].sort((a, b) => a - b);

  test("the random sequence is valid and every track applies", () => {
    const evaluator = make(sequence);
    expect(evaluator.warnings).toEqual([]);
    expect(evaluator.at(30000).report).toEqual([]);
  });

  test("at 1,000 random times: a fresh evaluator, playback, random seeks and a replay with no memo agree", () => {
    const fresh = new Map(ordered.map((t) => [t, stateOf(make(sequence).at(t))]));

    const play = make(sequence);
    let since = -1;
    const fired: string[] = [];
    for (const t of ordered) {
      const frame = play.at(t, since);
      expect(stateOf(frame)).toEqual(fresh.get(t)!);
      fired.push(...frame.fired.map((key) => `${String(key.track)}/${String(key.key)}`));
      since = t;
    }
    // The keys of all play steps are the keys of the whole range, each once and in the stable order.
    const all = play.firedBetween(-1, ordered.at(-1) ?? 0).map((key) => `${String(key.track)}/${String(key.key)}`);
    expect(fired).toEqual(all);

    const seek = make(sequence);
    times.forEach((t, index) => {
      if (index % 97 === 96) seek.clearMemo();
      expect(stateOf(seek.at(t))).toEqual(fresh.get(t)!);
    });

    // A step larger than the time line gives one checkpoint at 0. Thus each call replays all keys from the start.
    const noMemo = make(sequence, sequence.duration + 1);
    for (const t of ordered.filter((_, index) => index % 5 === 0)) {
      expect(noMemo.simulationsAt(t)).toEqual(fresh.get(t)!.simulations);
    }
  });

  test("a seek back and a seek forward give the frame of playback", () => {
    const play = make(sequence);
    const frames = ordered.slice(0, 50).map((t) => stateOf(play.at(t)));
    const back = make(sequence);
    back.at(sequence.duration);
    ordered
      .slice(0, 50)
      .reverse()
      .forEach((t, index) => expect(stateOf(back.at(t))).toEqual(frames[49 - index]!));
  });
});

describe("seek time", () => {
  test("a 10-minute sequence with many keys seeks in less than 5 ms on average after warm-up", () => {
    const random = seeded(600);
    const boxes = 20;
    const sequence = randomSequence(random, 600_000, boxes, 30);
    const keys = sequence.tracks.reduce((sum, track) => sum + track.keys.length, 0);
    expect(keys).toBeGreaterThan(15_000);
    const evaluator = createEvaluator({ scene: testScene(boxes), sequence, registry, simulations });
    evaluator.at(sequence.duration);
    for (let index = 0; index < 100; index += 1) evaluator.at(Math.floor(random() * sequence.duration));
    const seeks = Array.from({ length: 500 }, () => Math.floor(random() * (sequence.duration + 1)));
    const start = performance.now();
    for (const t of seeks) evaluator.at(t);
    const average = (performance.now() - start) / seeks.length;
    const factor = Number(process.env.SCENITY_CI_TIMING_FACTOR ?? "1") || 1;
    expect(average).toBeLessThan(5 * factor);
  });
});
