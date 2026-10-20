// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  blendWeights,
  constantParameters,
  createAnimator,
  defaultParameters,
  evaluateAnimator,
  type AnimatorFrame,
  type LayerPose,
} from "../src/animator/index";
import { randomSequence, robotAnimator, robotOptions, ROBOT_CLIPS, seeded } from "./animatorKit";

function base(frame: AnimatorFrame): LayerPose {
  const layer = frame.layers[0];
  if (layer === undefined) throw new Error("no layer");
  return layer;
}

/** The state of the first layer and the state before it in a crossfade. */
function stateAt(animator: ReturnType<typeof createAnimator>, t: number): string {
  const layer = base(animator.at(t));
  return layer.from === null ? layer.state : `${layer.from}>${layer.state}`;
}

describe("the controller of the characters sample: parameters change, states change", () => {
  const animator = createAnimator(robotOptions());

  test("idle, then walk from the speed key at 1000 ms, with a 250 ms crossfade", () => {
    expect(stateAt(animator, 0)).toBe("idle");
    expect(stateAt(animator, 999)).toBe("idle");
    expect(stateAt(animator, 1000)).toBe("idle>walk");
    expect(base(animator.at(1000)).fade).toBe(0);
    expect(base(animator.at(1125)).fade).toBeCloseTo(0.5, 6);
    expect(stateAt(animator, 1249)).toBe("idle>walk");
    expect(stateAt(animator, 1250)).toBe("walk");
  });

  test("the walk plays the walk clip of the 1D blend at speed 1, in a loop", () => {
    const layer = base(animator.at(2000));
    expect(layer.samples).toHaveLength(1);
    expect(layer.samples[0]).toMatchObject({ kind: "clip", clip: "Walking", weight: 1 });
    const cycle = 1000 / (ROBOT_CLIPS.Walking * 1000);
    expect(layer.phase).toBeCloseTo(cycle, 9);
  });

  test("stop at the speed key at 4000 ms, then wave from the wave key at 5000 ms", () => {
    expect(stateAt(animator, 3999)).toBe("walk");
    expect(stateAt(animator, 4000)).toBe("walk>idle");
    expect(stateAt(animator, 4250)).toBe("idle");
    expect(stateAt(animator, 4999)).toBe("idle");
    expect(stateAt(animator, 5000)).toBe("idle>wave");
    expect(stateAt(animator, 5200)).toBe("wave");
  });

  test("the wave plays one time and goes back to idle at its exit time", () => {
    // The exit time 1 of the wave state: 5000 ms + the clip length, at the next whole ms.
    const exit = Math.ceil(5000 + ROBOT_CLIPS.Wave * 1000);
    expect(exit).toBe(6834);
    expect(stateAt(animator, exit - 1)).toBe("wave");
    expect(base(animator.at(exit - 1)).samples[0]).toMatchObject({ clip: "Wave" });
    expect(stateAt(animator, exit)).toBe("wave>idle");
    // A once motion holds its last pose in the crossfade out.
    const fading = base(animator.at(exit + 100)).samples.find(
      (sample) => sample.kind === "clip" && sample.clip === "Wave",
    );
    expect(fading?.time).toBeCloseTo(ROBOT_CLIPS.Wave, 9);
    expect(stateAt(animator, exit + 300)).toBe("idle");
    expect(stateAt(animator, 9000)).toBe("idle");
  });

  test("the events of the states come at their times, each one time", () => {
    const events = createAnimator(robotOptions()).at(9000, -1).events;
    const waves = events.filter((event) => event.name === "wave");
    expect(waves.map((event) => event.t)).toEqual([Math.ceil(5000 + 0.5 * ROBOT_CLIPS.Wave * 1000)]);
    const steps = events.filter((event) => event.name.startsWith("step."));
    expect(steps[0]).toEqual({ t: 1048, layer: "base", state: "walk", name: "step.l" });
    expect(steps[1]?.t).toBe(1528);
    steps.forEach((event, index) => {
      expect(event.name).toBe(index % 2 === 0 ? "step.l" : "step.r");
      // The walk state plays from 1000 ms to the end of its crossfade out at 4250 ms.
      expect(event.t).toBeGreaterThan(1000);
      expect(event.t).toBeLessThanOrEqual(4250);
    });
    expect(steps.length).toBe(7);
  });

  test("a 1D blend mixes its two nearest clips and keeps them in step", () => {
    expect(blendWeights([{ at: 1 }, { at: 2 }], 1.25)).toEqual([0.75, 0.25]);
    expect(blendWeights([{ at: 1 }, { at: 2 }], 0)).toEqual([1, 0]);
    expect(blendWeights([{ at: 1 }, { at: 2 }], 3)).toEqual([0, 1]);
    const value = robotAnimator();
    const fast = createAnimator({
      value,
      clips: ROBOT_CLIPS,
      parameters: constantParameters({ ...defaultParameters(value), speed: 1.5 }),
    });
    const layer = base(fast.at(3000));
    expect(layer.state).toBe("walk");
    expect(layer.samples.map((sample) => [sample.kind === "clip" ? sample.clip : "", sample.weight])).toEqual([
      ["Walking", 0.5],
      ["Running", 0.5],
    ]);
    expect(layer.samples[0]?.time).toBeCloseTo(layer.samples[1]?.time ?? NaN, 12);
  });

  test("a time that is not a whole ms is an error", () => {
    expect(() => animator.at(10.5)).toThrow(RangeError);
  });
});

describe("seek equals play", () => {
  const random = seeded(607);
  const sequence = randomSequence(random, 30000);
  const options = robotOptions(sequence);
  const times = Array.from({ length: 1000 }, () => Math.floor(random() * 30001));
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  const withoutEvents = (frame: AnimatorFrame): AnimatorFrame => ({ ...frame, events: [] });

  test("at 1,000 random times: a run from 0, playback and random seeks give the same frame", () => {
    const fresh = new Map(ordered.map((t) => [t, evaluateAnimator(options, t)]));
    // The random sequence moves the states: each state of the controller plays.
    const states = new Set([...fresh.values()].map((frame) => base(frame).state));
    expect([...states].sort()).toEqual(["idle", "walk", "wave"]);

    const play = createAnimator(options);
    let since = -1;
    const events: string[] = [];
    for (const t of ordered) {
      const frame = play.at(t, since);
      expect(withoutEvents(frame)).toEqual(fresh.get(t)!);
      events.push(...frame.events.map((event) => `${String(event.t)} ${event.name}`));
      since = t;
    }
    // The events of all play steps are the events of the whole range, each one time and in order.
    const all = createAnimator(options).at(ordered.at(-1) ?? 0, -1).events;
    expect(events).toEqual(all.map((event) => `${String(event.t)} ${event.name}`));

    const seek = createAnimator(options);
    times.forEach((t, index) => {
      if (index % 97 === 96) seek.clearMemo();
      expect(withoutEvents(seek.at(t))).toEqual(fresh.get(t)!);
    });
  });

  test("a small checkpoint step and no memo give the same frames", () => {
    const small = createAnimator({ ...options, checkpointMs: 137 });
    const none = createAnimator({ ...options, checkpointMs: 1e9 });
    for (const t of ordered.filter((_, index) => index % 7 === 0).reverse()) {
      const reference = evaluateAnimator(options, t);
      expect(withoutEvents(small.at(t))).toEqual(reference);
      expect(withoutEvents(none.at(t))).toEqual(reference);
    }
  });
});
