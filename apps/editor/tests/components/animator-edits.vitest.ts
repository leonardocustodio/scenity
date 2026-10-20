// SPDX-License-Identifier: Apache-2.0
// The edits of the Animator window: a state and its rename in the start and the transitions, and the refusal to remove
// a used state or parameter. Also a transition, a parameter and a layer.
import type { AnimatorController } from "@scenity/scene/components";
import { describe, expect, it } from "vitest";
import * as edits from "../../src/scene/animator/animatorEdits";

const CONTROLLER: AnimatorController = {
  parameters: { speed: { type: "number", default: 0 } },
  layers: [
    {
      name: "base",
      start: "idle",
      states: { idle: { motion: { kind: "clip", clip: "Idle" } }, walk: { motion: { kind: "clip", clip: "Walking" } } },
      transitions: [{ from: "idle", to: "walk", when: [{ parameter: "speed", op: "gt", value: 0.1 }] }],
    },
  ],
};

describe("the edits of the animator", () => {
  it("adds, renames and removes states, and keeps the start and the transitions right", () => {
    const added = edits.withState(CONTROLLER, 0, "wave", "Wave");
    expect(added.layers[0]?.states.wave).toEqual({ motion: { kind: "clip", clip: "Wave" } });
    expect(() => edits.withState(added, 0, "wave", "Wave")).toThrow();
    const renamed = edits.renamedState(added, 0, "idle", "rest");
    expect(renamed.layers[0]?.start).toBe("rest");
    expect(renamed.layers[0]?.transitions?.[0]).toMatchObject({ from: "rest", to: "walk" });
    expect(() => edits.withoutState(renamed, 0, "rest")).toThrow();
    expect(() => edits.withoutState(renamed, 0, "walk")).toThrow();
    expect(Object.keys(edits.withoutState(renamed, 0, "wave").layers[0]?.states ?? {})).toEqual(["rest", "walk"]);
    expect(edits.motionWords(edits.withStateClip(added, 0, "wave", "Yes").layers[0]!.states.wave!)).toBe("Yes");
  });

  it("adds and removes transitions, parameters and layers", () => {
    const moved = edits.withTransition(CONTROLLER, 0, { from: "*", to: "idle" });
    expect(moved.layers[0]?.transitions).toHaveLength(2);
    expect(edits.withTransitionPatch(moved, 0, 1, { duration: 300 }).layers[0]?.transitions?.[1]).toEqual({
      from: "*",
      to: "idle",
      duration: 300,
    });
    expect(edits.withoutTransition(moved, 0, 0).layers[0]?.transitions).toEqual([{ from: "*", to: "idle" }]);
    const flag = edits.withParameter(CONTROLLER, "nod", "bool");
    expect(flag.parameters?.nod).toEqual({ type: "bool", default: false });
    expect(() => edits.withoutParameter(flag, "speed")).toThrow();
    expect(Object.keys(edits.withoutParameter(flag, "nod").parameters ?? {})).toEqual(["speed"]);
    const layered = edits.withLayer(CONTROLLER, "upper", "Wave");
    expect(layered.layers[1]).toEqual({
      name: "upper",
      start: "idle",
      states: { idle: { motion: { kind: "clip", clip: "Wave" } } },
    });
    expect(edits.withLayerPatch(layered, 1, { weight: 0.5, blend: "additive" }).layers[1]).toMatchObject({
      weight: 0.5,
      blend: "additive",
    });
  });
});
