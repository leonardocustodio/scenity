// SPDX-License-Identifier: Apache-2.0
// The edits of the inspector as scene ops: one field, one part of a vector, many entities, a reset to the default, the
// add and the remove of a component, and the overrides of a prefab entity. Each edit through the scene channel is one
// history step, and a live drag is also one step.
import { describe, expect, test } from "bun:test";
import { applyOps, type ComponentDefinition } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  addComponentOps,
  fieldOps,
  fieldState,
  initialComponent,
  nameOps,
  removeComponentOps,
  resetToDefaultOps,
  resetToPrefabOps,
  SCENE_SUBJECT,
  SceneChannel,
  subjectOf,
  subjectsOf,
  writeOp,
} from "../src/index";
import { beaconComponent, fixtureRegistry, gardenWithChair, sourceOf } from "./inspectorFixture";

function definition(id: string): ComponentDefinition {
  const found = fixtureRegistry.get(id);
  if (found === undefined) throw new Error(`no component ${id}`);
  return found;
}

function applied(doc: SceneDocument, ops: readonly SceneOp[]): SceneDocument {
  const result = applyOps(doc, ops, fixtureRegistry);
  if (!result.ok) throw new Error(result.reason);
  return result.doc;
}

describe("writeOp", () => {
  test("it names the deepest container that exists and starts a missing one from the defaults", () => {
    const stored = { position: [1, 2, 3] };
    const filled = { ...stored, scale: [1, 1, 1] };
    expect(writeOp(stored, filled, ["c"], ["position", "1"], 5)).toEqual({
      op: "set",
      path: "/c/position/1",
      value: 5,
    });
    expect(writeOp(stored, filled, ["c"], ["scale", "0"], 2)).toEqual({
      op: "set",
      path: "/c/scale",
      value: [2, 1, 1],
    });
    expect(writeOp(stored, filled, ["c"], ["position", "1"], 2)).toBeNull();
    expect(writeOp(stored, filled, ["c"], ["scale"], undefined)).toBeNull();
    expect(writeOp(undefined, {}, ["environment"], ["background"], "#ffffff")).toEqual({
      op: "set",
      path: "/environment",
      value: { background: "#ffffff" },
    });
  });
});

describe("the field edits", () => {
  const doc = gardenWithChair();
  const source = sourceOf(doc);
  const light = definition("light");
  const transform = definition("transform");

  test("a number of one entity is one set op", () => {
    const ops = fieldOps(source, subjectsOf(source, ["lamp"]), light, "intensity", 3);
    expect(ops).toEqual([{ op: "set", path: "/entities/lamp/components/light/intensity", value: 3 }]);
    expect(applied(doc, ops).entities.lamp?.components.light).toMatchObject({ intensity: 3 });
  });

  test("one part of a vector of many entities keeps the other parts of each", () => {
    const ops = fieldOps(source, subjectsOf(source, ["table", "bench"]), transform, ["position", "1"], 0.5);
    const next = applied(doc, ops);
    expect(next.entities.table?.components.transform).toEqual({ position: [0, 0.5, 0] });
    expect(next.entities.bench?.components.transform).toEqual({ position: [1.5, 0.5, -1] });
    // A part of a vector that the document does not store starts from the default.
    const scale = fieldOps(source, subjectsOf(source, ["table"]), transform, ["scale", "2"], 2);
    expect(scale).toEqual([{ op: "set", path: "/entities/table/components/transform/scale", value: [1, 1, 2] }]);
  });

  test("a reset to the default removes the stored key", () => {
    const ops = resetToDefaultOps(source, subjectsOf(source, ["lamp", "sun"]), light, "intensity");
    expect(ops).toHaveLength(2);
    const next = applied(doc, ops);
    expect(fieldState(sourceOf(next), subjectsOf(sourceOf(next), ["lamp"]), light, "intensity")).toMatchObject({
      value: 1,
      stored: false,
    });
  });

  test("a bad value gets the refusal of the schema", () => {
    const ops = fieldOps(source, subjectsOf(source, ["lamp"]), light, "type", "laser");
    const result = applyOps(doc, ops, fixtureRegistry);
    expect(result.ok).toBe(false);
  });

  test("the name and the scene-level values", () => {
    expect(nameOps(subjectsOf(source, ["table"]), "Desk")).toEqual([
      { op: "set", path: "/entities/table/name", value: "Desk" },
    ]);
    expect(nameOps(subjectsOf(source, ["table"]), " ")).toEqual([{ op: "set", path: "/entities/table/name" }]);
    const environment = definition("environment");
    const ops = fieldOps(source, [SCENE_SUBJECT], environment, "exposure", 1.5);
    expect(applied(doc, ops).environment).toEqual({ exposure: 1.5 });
  });

  test("a component of a plugin goes on and off as one edit for each entity", () => {
    const subjects = subjectsOf(source, ["table", "bench"]);
    const add = addComponentOps(subjects, beaconComponent, initialComponent(beaconComponent));
    expect(add).toHaveLength(2);
    const next = applied(doc, add);
    expect(next.entities.bench?.components["fixture.beacon"]).toEqual({ rate: 0, mode: "steady" });
    const nextSource = sourceOf(next);
    const edit = fieldOps(nextSource, subjectsOf(nextSource, ["table", "bench"]), beaconComponent, "tint", "#00ff00");
    expect(applied(next, edit).entities.table?.components["fixture.beacon"]).toMatchObject({ tint: "#00ff00" });
    const remove = removeComponentOps(subjectsOf(nextSource, ["table", "bench"]), beaconComponent);
    expect(applied(next, remove).entities.table?.components["fixture.beacon"]).toBeUndefined();
  });
});

describe("the overrides of a prefab entity", () => {
  const doc = gardenWithChair();
  const source = sourceOf(doc);
  const shape = definition("shape");
  const overridesOf = (next: SceneDocument) =>
    (next.entities.chair?.components.prefab as { overrides?: SceneOp[] }).overrides;

  test("an edit replaces the override of its path; the prefab document does not change", () => {
    const seat = subjectsOf(source, ["chair/seat"]);
    const next = applied(doc, fieldOps(source, seat, shape, "colour", "#00ff00"));
    expect(overridesOf(next)).toEqual([
      { op: "set", path: "/entities/seat/components/shape/colour", value: "#00ff00" },
    ]);
    const sized = applied(
      next,
      fieldOps(sourceOf(next), subjectsOf(sourceOf(next), ["chair/seat"]), shape, ["size", "0"], 1),
    );
    expect(overridesOf(sized)).toHaveLength(2);
    const state = fieldState(sourceOf(sized), subjectsOf(sourceOf(sized), ["chair/seat"]), shape, "size");
    expect(state).toMatchObject({ value: [1, 0.05, 0.5], overridden: true, prefabValue: [0.5, 0.05, 0.5] });
  });

  test("a reset to the prefab value removes the overrides of the path", () => {
    const seat = subjectsOf(source, ["chair/seat"]);
    const ops = resetToPrefabOps(seat, shape, "colour");
    expect(ops).toEqual([{ op: "set", path: "/entities/chair/components/prefab/overrides" }]);
    const next = applied(doc, ops);
    expect(overridesOf(next)).toBeUndefined();
    expect(fieldState(sourceOf(next), subjectsOf(sourceOf(next), ["chair/seat"]), shape, "colour")).toMatchObject({
      value: "#888888",
      overridden: false,
    });
    expect(resetToPrefabOps(subjectsOf(source, ["table"]), shape, "colour")).toEqual([]);
  });

  test("a component goes on a prefab entity as an override, and off again", () => {
    const base = subjectOf(source, "chair/base");
    if (base === null) throw new Error("no base");
    const light = definition("light");
    const next = applied(doc, addComponentOps([base], light, { type: "point" }));
    expect(overridesOf(next)?.at(-1)).toEqual({
      op: "addComponent",
      id: "base",
      component: "light",
      value: { type: "point" },
    });
    const again = subjectOf(sourceOf(next), "chair/base");
    if (again === null) throw new Error("no base");
    expect(again.entity.components.light).toEqual({ type: "point" });
    const removed = applied(next, removeComponentOps([again], light));
    expect(overridesOf(removed)).toHaveLength(1);
    // The prefab has the shape of the seat, so its removal is an override.
    const seat = subjectOf(source, "chair/seat");
    if (seat === null) throw new Error("no seat");
    const off = applied(doc, removeComponentOps([seat], shape));
    expect(overridesOf(off)).toEqual([{ op: "removeComponent", id: "seat", component: "shape" }]);
  });
});

describe("one history step for each edit", () => {
  test("an edit is one step; a live drag of a number is one step", () => {
    const doc = gardenWithChair();
    const patches: SceneOp[][] = [];
    const channel = new SceneChannel({ doc, registry: fixtureRegistry, patch: (ops) => patches.push([...ops]) });
    const light = definition("light");
    const source = () => sourceOf(channel.doc);
    channel.edit(fieldOps(source(), subjectsOf(source(), ["lamp"]), light, "intensity", 4), "Intensity");
    channel.begin();
    for (const value of [1.1, 1.2, 1.3]) {
      channel.move(fieldOps(source(), subjectsOf(source(), ["sun"]), light, "intensity", value));
    }
    channel.end();
    expect(channel.doc.entities.sun?.components.light).toMatchObject({ intensity: 1.3 });
    expect(patches.length).toBe(4);
    expect(channel.undo()).toBe(true);
    expect(channel.doc.entities.sun?.components.light).toMatchObject({ intensity: 1.5 });
    expect(channel.doc.entities.lamp?.components.light).toMatchObject({ intensity: 4 });
    expect(channel.undo()).toBe(true);
    expect(channel.doc.entities.lamp?.components.light).toMatchObject({ intensity: 2 });
    expect(channel.undo()).toBe(false);
  });
});
