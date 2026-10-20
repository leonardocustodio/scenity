// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  applyOverridesToPrefab,
  checkTree,
  childrenOf,
  expandPrefabs,
  unpack,
  type PrefabDocument,
  type PrefabResolver,
  type SceneDocument,
} from "../src/index";
import { deepFreeze, fixture, registry } from "./helpers";

const workshop = deepFreeze(fixture("workshop.scene.json", "scene"));
const door = deepFreeze(fixture("door.prefab.json", "prefab"));
const resolver =
  (prefabs: Record<string, PrefabDocument>): PrefabResolver =>
  (source) =>
    prefabs[source];
const paint = (doc: SceneDocument, id: string) =>
  (doc.entities[id]?.components.model as { materials: { paint: { colour: string; roughness?: number } } }).materials
    .paint;

describe("prefabs", () => {
  test("expandPrefabs puts the prefab tree under each instance with the IDs <instance>/<entity>", () => {
    const { doc, report } = expandPrefabs(workshop, resolver({ "door.prefab.json": door }), registry);
    expect(report).toEqual([]);
    expect(childrenOf(doc.entities, "door")).toEqual(["door/frame"]);
    expect(childrenOf(doc.entities, "door/frame")).toEqual(["door/leaf"]);
    expect(doc.entities["door-2/handle"]?.parent).toBe("door-2/leaf");
    expect(checkTree(doc.entities)).toEqual([]);
    // The instance override of "door" changes its leaf colour only.
    expect(paint(doc, "door/leaf").colour).toBe("#aa3333");
    expect(paint(doc, "door-2/leaf").colour).toBe("#4a6fa5");
  });

  test("a prefab change shows in every instance, and an instance override stays", () => {
    const changed = applyOps(
      door,
      [
        { op: "set", path: "/entities/leaf/components/model/materials/paint/roughness", value: 0.2 },
        { op: "set", path: "/entities/leaf/components/model/materials/paint/colour", value: "#00ff00" },
      ],
      registry,
    );
    if (!changed.ok) throw new Error(changed.reason);
    const { doc } = expandPrefabs(workshop, resolver({ "door.prefab.json": changed.doc }), registry);
    expect(paint(doc, "door/leaf")).toEqual({ colour: "#aa3333", roughness: 0.2 });
    expect(paint(doc, "door-2/leaf")).toEqual({ colour: "#00ff00", roughness: 0.2 });
  });

  test("an override that no longer applies gives a report entry", () => {
    const removed = applyOps(door, [{ op: "remove", id: "leaf" }], registry);
    if (!removed.ok) throw new Error(removed.reason);
    const { doc, report } = expandPrefabs(workshop, resolver({ "door.prefab.json": removed.doc }), registry);
    expect(report).toHaveLength(1);
    expect(report[0]?.entity).toBe("door");
    expect(doc.entities["door/frame"]).toBeDefined();
  });

  test("nested prefabs expand, and a cycle is reported", () => {
    const room: PrefabDocument = {
      format: "scenity.prefab/1",
      id: "room",
      root: "base",
      entities: {
        base: { parent: null, index: 0, components: {} },
        entry: { parent: "base", index: 0, components: { prefab: { source: "door.prefab.json" } } },
      },
    };
    const scene: SceneDocument = {
      format: "scenity.scene/1",
      id: "s",
      entities: { r: { parent: null, index: 0, components: { prefab: { source: "room.prefab.json" } } } },
    };
    const { doc, report } = expandPrefabs(
      scene,
      resolver({ "room.prefab.json": room, "door.prefab.json": door }),
      registry,
    );
    expect(report).toEqual([]);
    expect(doc.entities["r/entry/handle"]?.parent).toBe("r/entry/leaf");
    expect(checkTree(doc.entities)).toEqual([]);
    const loop: PrefabDocument = {
      ...room,
      entities: {
        ...room.entities,
        entry: { parent: "base", index: 0, components: { prefab: { source: "room.prefab.json" } } },
      },
    };
    const cycle = expandPrefabs(scene, resolver({ "room.prefab.json": loop }), registry);
    expect(cycle.report).toEqual([{ entity: "r/entry", reason: 'the prefab "room" holds itself: room > room' }]);
    const missing = expandPrefabs(scene, resolver({}), registry);
    expect(missing.report[0]?.reason).toContain("not found");
  });
});

describe("unpack and apply the overrides", () => {
  test("unpack makes plain entities with the overrides; its inverse gives the instance back", () => {
    const result = unpack(workshop, "door", resolver({ "door.prefab.json": door }), registry);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ids).toEqual({ frame: "door-frame", leaf: "door-leaf", handle: "door-handle" });
    expect(result.doc.entities.door?.components.prefab).toBeUndefined();
    expect(result.doc.entities["door-frame"]?.parent).toBe("door");
    expect(result.doc.entities["door-handle"]?.parent).toBe("door-leaf");
    expect(paint(result.doc, "door-leaf").colour).toBe("#aa3333");
    expect(checkTree(result.doc.entities)).toEqual([]);
    const back = applyOps(result.doc, result.inverse, registry);
    expect(back.ok && back.doc).toEqual(workshop);
  });

  test("applyOverridesToPrefab moves the overrides into the prefab", () => {
    const result = applyOverridesToPrefab(workshop, "door", door, registry);
    if (!result.ok) throw new Error(result.reason);
    expect(
      (result.prefab.entities.leaf?.components.model as { materials: { paint: { colour: string } } }).materials.paint
        .colour,
    ).toBe("#aa3333");
    expect(result.scene.entities.door?.components.prefab).toEqual({ source: "door.prefab.json" });
    // Each instance shows the colour of the prefab.
    const { doc } = expandPrefabs(result.scene, resolver({ "door.prefab.json": result.prefab }), registry);
    expect(paint(doc, "door/leaf").colour).toBe("#aa3333");
    expect(paint(doc, "door-2/leaf").colour).toBe("#aa3333");
    expect(applyOverridesToPrefab(workshop, "cart", door, registry).ok).toBe(false);
  });
});
