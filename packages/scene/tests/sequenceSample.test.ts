// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  applyEase,
  bezierEase,
  EASE_NAMES,
  qslerp,
  readDocument,
  sampleTrack,
  type Ease,
  type Quat,
  type Track,
  type TrackSampleOf,
} from "../src/index";
import { seeded } from "./helpers";

const EASES: Ease[] = [...EASE_NAMES, { bezier: [0.25, 0.1, 0.25, 1] }, { bezier: [0.9, 0, 0.1, 1] }];

describe("ease curves", () => {
  test.each(EASES.map((ease) => [JSON.stringify(ease), ease] as const))(
    "%s: 0 at the start and 1 at the end",
    (_, e) => {
      expect(applyEase(e, 0)).toBe(0);
      expect(applyEase(e, 1)).toBe(1);
      expect(applyEase(e, -0.5)).toBe(0);
      expect(applyEase(e, 1.5)).toBe(1);
    },
  );

  test("linear gives u; step gives 0 until the end", () => {
    expect(applyEase("linear", 0.3)).toBe(0.3);
    expect(applyEase(undefined, 0.3)).toBe(0.3);
    expect(applyEase("step", 0.999)).toBe(0);
  });

  test("the named curves are the CSS curves", () => {
    expect(applyEase("inOut", 0.5)).toBeCloseTo(0.5, 9);
    expect(applyEase("in", 0.5)).toBeLessThan(0.5);
    expect(applyEase("out", 0.5)).toBeGreaterThan(0.5);
    // The CSS `ease` curve at x = 0.5 is about 0.8024.
    expect(bezierEase([0.25, 0.1, 0.25, 1], 0.5)).toBeCloseTo(0.8024, 3);
  });

  test("a Bézier curve with y1 and y2 in 0..1 is monotonic, also for steep control points", () => {
    const random = seeded(7);
    for (let curve = 0; curve < 200; curve += 1) {
      const points = [random(), random(), random(), random()] as const;
      let before = 0;
      for (let step = 1; step <= 200; step += 1) {
        const value = bezierEase(points, step / 200);
        expect(value).toBeGreaterThanOrEqual(before - 1e-9);
        before = value;
      }
    }
    // x1 = 1 and x2 = 0 make a flat part in x: the solver must find one answer all the same.
    expect(bezierEase([1, 0, 0, 1], 0.5)).toBeCloseTo(0.5, 6);
  });

  test("the identity Bézier curve gives u", () => {
    for (const u of [0.1, 0.37, 0.5, 0.92]) expect(bezierEase([1 / 3, 1 / 3, 2 / 3, 2 / 3], u)).toBeCloseTo(u, 9);
  });
});

describe("qslerp", () => {
  test("gives the ends, the middle and the shorter arc", () => {
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    expect(qslerp(a, b, 0)).toEqual(a);
    qslerp(a, b, 1).forEach((part, index) => expect(part).toBeCloseTo(b[index] ?? 0, 12));
    const half = qslerp(a, b, 0.5);
    expect(half[1]).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    const negative = qslerp(a, [-0, -Math.SQRT1_2, -0, -Math.SQRT1_2], 0.5);
    expect(negative[1]).toBeCloseTo(half[1], 12);
    expect(negative[3]).toBeCloseTo(half[3], 12);
  });
});

describe("sampleTrack: the curves", () => {
  const fov: Track = {
    kind: "property",
    entity: "cam",
    path: "camera/fov",
    keys: [
      { t: 1000, value: 40 },
      { t: 3000, value: 60 },
      { t: 5000, value: 20, ease: "step" },
      { t: 5000, value: 10 },
    ],
  };
  const value = (t: number) => (sampleTrack(fov, t) as TrackSampleOf<"property">).value;

  test("a property holds the first value before the first key and the last value after the last key", () => {
    expect(value(0)).toBe(40);
    expect(value(1000)).toBe(40);
    expect(value(2000)).toBe(50);
    expect(value(4999)).toBe(60);
    // Two keys at one time: the later key in the file wins.
    expect(value(5000)).toBe(10);
    expect(value(9000)).toBe(10);
  });

  test("number lists interpolate; other values step at the next key", () => {
    const track: Track = {
      kind: "property",
      entity: "sun",
      path: "light/colour",
      keys: [
        { t: 0, value: [0, 0, 0] },
        { t: 100, value: [100, 50, 10] },
        { t: 200, value: "#ffffff" },
      ],
    };
    expect((sampleTrack(track, 50) as TrackSampleOf<"property">).value).toEqual([50, 25, 5]);
    expect((sampleTrack(track, 150) as TrackSampleOf<"property">).value).toEqual([100, 50, 10]);
    expect((sampleTrack(track, 200) as TrackSampleOf<"property">).value).toBe("#ffffff");
  });

  test("a transform samples each part over the keys that hold it, with slerp for the rotation", () => {
    const track: Track = {
      kind: "transform",
      entity: "box",
      keys: [
        { t: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { t: 1000, scale: [2, 2, 2] },
        { t: 2000, position: [2, 0, 0], rotation: [0, 1, 0, 0] },
      ],
    };
    const sample = sampleTrack(track, 1000) as TrackSampleOf<"transform">;
    expect(sample.position).toEqual([1, 0, 0]);
    expect(sample.scale).toEqual([2, 2, 2]);
    expect(sample.rotation?.[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sample.rotation?.[3]).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("sampleTrack: the step tracks", () => {
  test("step tracks give nothing before the first key", () => {
    const visibility: Track = { kind: "visibility", entity: "box", keys: [{ t: 100, visible: false }] };
    expect(sampleTrack(visibility, 99)).toEqual({ kind: "visibility", entity: "box", visible: undefined });
    expect(sampleTrack(visibility, 100)).toEqual({ kind: "visibility", entity: "box", visible: false });
    const camera: Track = {
      kind: "camera",
      keys: [
        { t: 10, camera: "entity:a" },
        { t: 20, camera: "entity:b" },
      ],
    };
    expect(sampleTrack(camera, 5)).toEqual({ kind: "camera", camera: undefined });
    expect(sampleTrack(camera, 19)).toEqual({ kind: "camera", camera: "entity:a" });
    const attach: Track = {
      kind: "attach",
      entity: "x",
      keys: [
        { t: 10, to: "entity:a#hand" },
        { t: 20, to: null },
      ],
    };
    expect(sampleTrack(attach, 15)).toEqual({ kind: "attach", entity: "x", to: "entity:a#hand" });
    expect(sampleTrack(attach, 20)).toEqual({ kind: "attach", entity: "x", to: null });
  });

  test("event and action tracks give the index of the last key at or before t", () => {
    const track: Track = {
      kind: "event",
      keys: [
        { t: 10, name: "a" },
        { t: 10, name: "b" },
        { t: 30, name: "c" },
      ],
    };
    expect(sampleTrack(track, 5)).toEqual({ kind: "event", entity: undefined, last: -1 });
    expect(sampleTrack(track, 10)).toEqual({ kind: "event", entity: undefined, last: 1 });
    expect(sampleTrack(track, 40)).toEqual({ kind: "event", entity: undefined, last: 2 });
  });

  test("an animation gives the clip with its local time, and a crossfade in the blend time", () => {
    const track: Track = {
      kind: "animation",
      entity: "bot",
      keys: [
        { t: 1000, clip: "asset:walk", speed: 2, loop: true },
        { t: 3000, clip: "asset:wave", blend: 400 },
        { t: 5000, clip: null, blend: 1000 },
      ],
    };
    const clips = (t: number) => (sampleTrack(track, t) as TrackSampleOf<"animation">).clips;
    expect(clips(500)).toEqual([]);
    expect(clips(1500)).toEqual([{ clip: "asset:walk", start: 1000, time: 1000, speed: 2, loop: true, weight: 1 }]);
    expect(clips(3100)).toEqual([
      { clip: "asset:walk", start: 1000, time: 4200, speed: 2, loop: true, weight: 0.75 },
      { clip: "asset:wave", start: 3000, time: 100, speed: 1, loop: false, weight: 0.25 },
    ]);
    expect(clips(3400)).toEqual([{ clip: "asset:wave", start: 3000, time: 400, speed: 1, loop: false, weight: 1 }]);
    expect(clips(5500)).toEqual([{ clip: "asset:wave", start: 3000, time: 2500, speed: 1, loop: false, weight: 0.5 }]);
    expect(clips(6000)).toEqual([]);
  });

  test("an animation key names a clip in its asset", () => {
    const track: Track = {
      kind: "animation",
      entity: "bot",
      keys: [{ t: 0, clip: "asset:robot", name: "Wave", loop: true }],
    };
    const clips = (sampleTrack(track, 250) as TrackSampleOf<"animation">).clips;
    expect(clips).toEqual([
      { clip: "asset:robot", name: "Wave", start: 0, time: 250, speed: 1, loop: true, weight: 1 },
    ]);
    const read = readDocument(
      JSON.stringify({ format: "scenity.sequence/1", id: "clips", scene: "test", duration: 1000, tracks: [track] }),
      "sequence",
    );
    expect(read.ok).toBe(true);
  });
});
