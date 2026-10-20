// SPDX-License-Identifier: Apache-2.0
// The take model of the lab core (src/core/sequence.ts) on the fake lab plugin of the tests. The core reads the takes,
// the state, the moments, the marks and the lanes of the registered plugin when a function runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registeredPlugin, registerEditorPlugin, type EditorPlugin } from "../../src/core/plugin";
import {
  allMoments,
  compareTakeName,
  decodeEvents,
  defaultTakeName,
  encodeEvents,
  labStateAt,
  memberLabel,
  momentsOf,
  phaseMarks,
  takeEnd,
  takeLanesIn,
  takeLength,
  takeList,
  takeNamed,
  takeSwept,
} from "../../src/core/sequence";
import { FIXTURE_MOMENTS, fixtureLabPlugin } from "../fixtures/lab-plugin/labPlugin";

let before: EditorPlugin | null = null;
beforeAll(() => {
  before = registeredPlugin();
  registerEditorPlugin(fixtureLabPlugin);
});
afterAll(() => {
  if (before !== null) registerEditorPlugin(before);
});

describe("the take model of the lab core on the fake lab plugin", () => {
  it("lists the takes in their order and finds a take by its name", () => {
    expect(takeList().map((take) => take.name)).toEqual(["idle", "greet", "parade"]);
    expect(takeNamed("parade")?.label).toBe("Parade");
    expect(takeNamed("nothing")).toBeUndefined();
    expect(takeNamed(null)).toBeUndefined();
  });

  it("gives the state of the take at a time from its events", () => {
    const events = takeNamed("greet")?.events ?? [];
    expect(labStateAt(events, 1_000).members).toEqual([
      { id: "ada", at: "hall" },
      { id: "bo", at: "stage" },
    ]);
    expect(labStateAt(events, 1_500).members[0]).toEqual({ id: "ada", at: "door" });
    expect(takeEnd(events)).toBe(4_000);
  });

  it("gives the moments of a take, and none for an unknown take", () => {
    expect(momentsOf("greet")).toEqual(FIXTURE_MOMENTS.greet);
    expect(momentsOf("nothing")).toEqual({});
    expect(momentsOf(null)).toEqual({});
    expect(Object.keys(allMoments())).toEqual(["greet", "parade"]);
  });

  it("encodes the events of a take and decodes them back", () => {
    const events = takeNamed("parade")?.events ?? [];
    expect(decodeEvents(encodeEvents(events))).toEqual(events);
    expect(decodeEvents("not a list")).toBeNull();
  });

  it("gives the marks, the lanes and the sweep of a take", () => {
    const events = takeNamed("parade")?.events ?? [];
    expect(phaseMarks(events, 2_200)).toEqual([{ at: 2_000, label: "ada to stage" }]);
    expect(takeLanesIn("parade", 0, 1_000)).toEqual({ ada: [{ clip: "walk", family: "walk", from: 0, to: 1_000 }] });
    expect(takeLength("greet")).toBe(6_000);
    expect(takeSwept("parade")).toBe(true);
    expect(takeSwept("idle")).toBe(false);
  });

  it("gives the default takes and the member names by the generic rules", () => {
    expect(defaultTakeName()).toBe("greet");
    expect(compareTakeName("greet")).toBe("parade");
    expect(compareTakeName("parade")).toBe("greet");
    expect(compareTakeName(null)).toBe("greet");
    expect(memberLabel("ada")).toBe("ada");
  });

  it("gives the default takes and the member names of the plugin when it has them", () => {
    const sequence = {
      ...fixtureLabPlugin.sequence,
      defaultTake: "parade",
      compareTake: "idle",
      memberLabel: (member: string) => member.toUpperCase(),
    };
    registerEditorPlugin({ ...fixtureLabPlugin, sequence });
    try {
      expect(defaultTakeName()).toBe("parade");
      expect(compareTakeName("parade")).toBe("idle");
      expect(memberLabel("ada")).toBe("ADA");
    } finally {
      registerEditorPlugin(fixtureLabPlugin);
    }
  });
});
