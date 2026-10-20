// SPDX-License-Identifier: Apache-2.0
// The curve editor v2: the eases of a key (each name and a Bézier), the two tangent handles of a Bézier in its segment,
// and the curves of many tracks at the same time.
import type { SequenceDocument } from "@scenity/scene/sequence";
import { describe, expect, it } from "vitest";
import { bezierOf, dragHandle, easeArg, easeKind, handlesOf } from "../../src/scene/sequencer/curveEase";
import { curvesOf, curveTracks } from "../../src/scene/sequencer/sequencerModel";

describe("the eases of the curve editor", () => {
  it("names each ease and gives the control points of a name or a Bézier", () => {
    expect(easeKind(undefined)).toBe("linear");
    expect(easeKind("inOut")).toBe("inOut");
    expect(easeKind({ bezier: [0.1, 0.2, 0.3, 0.4] })).toBe("bezier");
    expect(bezierOf("step")).toBeNull();
    expect(bezierOf("out")).toEqual([0, 0, 0.58, 1]);
    expect(bezierOf({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(easeArg("in")).toBe("in");
    expect(easeArg({ bezier: [0.1, 0.2, 0.3, 0.4] })).toBe('{"bezier":[0.1,0.2,0.3,0.4]}');
  });

  it("puts the tangent handles in the segment, and a drag keeps x in 0..1", () => {
    const segment = { t0: 1000, v0: 0, t1: 3000, v1: 10 };
    expect(handlesOf(segment, [0.25, 0.5, 0.75, 1])).toEqual([
      { t: 1500, v: 5 },
      { t: 2500, v: 10 },
    ]);
    expect(dragHandle(segment, [0.25, 0.5, 0.75, 1], 0, 2000, 12)).toEqual({ bezier: [0.5, 1.2, 0.75, 1] });
    expect(dragHandle(segment, [0.25, 0.5, 0.75, 1], 1, 9000, 5).bezier.slice(2)).toEqual([1, 0.5]);
  });
});

describe("the curves of many tracks", () => {
  it("shows the lines of each number track with one value range", () => {
    const sequence = {
      format: "scenity.sequence/1",
      id: "s",
      scene: "room",
      duration: 2000,
      tracks: [
        {
          kind: "property",
          entity: "sun",
          path: "light/intensity",
          keys: [
            { t: 0, value: 1 },
            { t: 2000, value: 3 },
          ],
        },
        { kind: "visibility", entity: "lamp", keys: [{ t: 0, visible: true }] },
        {
          kind: "transform",
          entity: "box",
          keys: [
            { t: 0, position: [0, 0, 0] },
            { t: 1000, position: [5, 1, 0] },
          ],
        },
      ],
    } as unknown as SequenceDocument;
    expect(curveTracks(sequence)).toEqual([0, 2]);
    const curve = curvesOf(sequence, [0, 2]);
    expect(curve?.lines.map((line) => line.track)).toEqual([0, 2, 2, 2]);
    expect(curve?.lines[1]?.label).toContain(": ");
    expect((curve?.min ?? 0) <= 0 && (curve?.max ?? 0) >= 5).toBe(true);
    expect(curvesOf(sequence, [1])).toBeNull();
  });
});
