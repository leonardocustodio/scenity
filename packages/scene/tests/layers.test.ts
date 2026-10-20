// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  applyLayers,
  applyOps,
  diffDocuments,
  overridesOf,
  variantFromDiff,
  variantNames,
  variantPath,
  writeDocument,
  type SceneDocument,
  type SceneOp,
} from "../src/index";
import { deepFreeze, fixture, registry, seeded } from "./helpers";
import { randomOp } from "./opGen";

const scene = deepFreeze(fixture("main.scene.json", "scene"));
const wide = fixture("wide.overrides.json", "overrides");
const xPath = "/entities/cart/components/transform/position/0";

describe("override layers", () => {
  test("a variant layer applies on top of the scene", () => {
    const result = applyLayers(scene, [wide], registry);
    expect(result.report).toEqual([]);
    expect((result.doc.entities.cart?.components.transform as { position: number[] }).position[0]).toBe(0.9);
    expect(scene.entities.cart?.components.transform).toMatchObject({ position: [0.85, 0, -1.45] });
  });

  test("the layers apply in the given order: the last one wins", () => {
    const pane = overridesOf("main", [{ op: "set", path: xPath, value: 1.2 }], "pane");
    const position = (layers: Parameters<typeof applyLayers>[1]) =>
      (applyLayers(scene, layers, registry).doc.entities.cart?.components.transform as { position: number[] })
        .position[0];
    expect(position([wide, pane])).toBe(1.2);
    expect(position([pane, wide])).toBe(0.9);
  });

  test("a layer for another scene is refused", () => {
    const other = overridesOf("lobby", [{ op: "set", path: xPath, value: 3 }], "lobby layout");
    const result = applyLayers(scene, [other, wide], registry);
    expect(result.report).toEqual([
      { layer: 0, name: "lobby layout", reason: 'the layer is for the scene "lobby", not "main"' },
    ]);
    expect((result.doc.entities.cart?.components.transform as { position: number[] }).position[0]).toBe(0.9);
  });

  test("an op that no longer applies gives a report entry, and the next ops apply", () => {
    const removed = applyOps(scene, [{ op: "remove", id: "lamp" }], registry);
    if (!removed.ok) throw new Error(removed.reason);
    const layer = overridesOf("main", [
      { op: "set", path: "/entities/lamp/components/light/intensity", value: 5 },
      { op: "set", path: xPath, value: 2 },
    ]);
    const result = applyLayers(removed.doc, [layer], registry);
    expect(result.report).toEqual([{ layer: 0, op: 0, reason: 'the entity "lamp" does not exist' }]);
    expect((result.doc.entities.cart?.components.transform as { position: number[] }).position[0]).toBe(2);
  });

  test("the variants of a scene name override files relative to the scene file", () => {
    expect(variantNames(scene)).toEqual(["wide"]);
    expect(variantPath(scene, "wide", "scenes/main.scene.json")).toBe("scenes/variants/wide.overrides.json");
    expect(variantPath(scene, "narrow", "scenes/main.scene.json")).toBeUndefined();
  });
});

describe("diffDocuments and save as variant", () => {
  test("the diff of a small edit is a short set list", () => {
    const edited = applyOps(scene, [{ op: "set", path: xPath, value: 0.9 }], registry);
    if (!edited.ok) throw new Error(edited.reason);
    const variant = variantFromDiff(scene, edited.doc);
    expect(writeDocument(variant)).toBe(writeDocument(wide));
  });

  test("a turn is one set of the whole quaternion, so each op gives a unit quaternion", () => {
    const path = "/entities/cart/components/transform/rotation";
    const half = Math.SQRT1_2;
    const turned = applyOps(scene, [{ op: "set", path, value: [0, half, 0, half] }], registry);
    if (!turned.ok) throw new Error(turned.reason);
    expect(diffDocuments(scene, turned.doc)).toEqual([{ op: "set", path, value: [0, half, 0, half] }]);
    for (const op of diffDocuments(turned.doc, scene)) expect(applyOps(turned.doc, [op], registry).ok).toBe(true);
  });

  test("the diff of equal scenes is empty", () => {
    expect(diffDocuments(scene, scene)).toEqual([]);
  });

  test("400 random edits: the diff changes the base into the edited scene", () => {
    const random = seeded(7);
    const bases = [scene, deepFreeze(fixture("workshop.scene.json", "scene"))];
    for (let index = 0; index < 400; index += 1) {
      const base = bases[index % 2]!;
      let doc: SceneDocument = base;
      const counter = { next: 0 };
      for (let count = 0; count < 1 + Math.floor(random() * 10);) {
        const op: SceneOp | undefined = randomOp(doc, random, counter);
        if (op === undefined) continue;
        const step = applyOps(doc, [op], registry);
        if (step.ok) doc = step.doc;
        count += 1;
      }
      const ops = diffDocuments(base, doc);
      const result = applyOps(base, ops, registry);
      if (!result.ok)
        throw new Error(`case ${String(index)}: op ${String(result.index)}: ${result.reason}\n${JSON.stringify(ops)}`);
      expect(writeDocument(result.doc)).toBe(writeDocument(doc));
    }
  });
});
