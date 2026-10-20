// SPDX-License-Identifier: Apache-2.0
// The prefabs of the editor: make a prefab from one or two selected entities (the selection becomes one instance in
// its place), the path of the prefab from the scene, and the edits of the entities of an instance as overrides of the
// instance. Also the variants and the nested prefabs.
import { applyOps, builtinRegistry, expandPrefabs, prefabSetResolver } from "@scenity/scene";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "bun:test";
import { EditError } from "../src/ops";
import { makePrefab, makeVariant, rebasedSource, relativePath } from "../src/prefabs/make";
import { routeOverrides } from "../src/prefabs/routing";

const registry = builtinRegistry();

const SCENE = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { transform: { position: [2, 0, 0] } } },
    cup: { name: "Cup", parent: "table", index: 0, components: { transform: { position: [0, 1, 0] } } },
    chair: { name: "Chair", parent: null, index: 1, components: { transform: { position: [4, 0, 2] } } },
    lamp: { name: "Lamp", parent: null, index: 2, components: {} },
  },
} as unknown as SceneDocument;

describe("make a prefab from the selection", () => {
  it("makes one root the root of the prefab, and puts the instance in its place", () => {
    const made = makePrefab(SCENE, ["table", "cup"], "Desk", "../prefabs/desk.prefab.json");
    expect(made.prefab.root).toBe("table");
    expect(Object.keys(made.prefab.entities).sort()).toEqual(["cup", "table"]);
    expect(made.prefab.entities.table?.components.transform).toEqual({ position: [0, 0, 0] });
    const applied = applyOps(SCENE, [...made.ops], registry);
    if (!applied.ok) throw new Error(applied.reason);
    expect(Object.keys(applied.doc.entities).sort()).toEqual(["chair", "desk", "lamp"]);
    expect(applied.doc.entities.desk).toMatchObject({
      parent: null,
      index: 2,
      components: { transform: { position: [2, 0, 0] }, prefab: { source: "../prefabs/desk.prefab.json" } },
    });
    // The expansion of the instance gives the table and the cup at their places again.
    const resolve = () => made.prefab;
    const expanded = expandPrefabs(applied.doc, resolve, registry).doc;
    expect(expanded.entities["desk/cup"]?.parent).toBe("desk/table");
  });

  it("puts two roots under a new root at their middle", () => {
    const made = makePrefab(SCENE, ["table", "chair"], "Set", "a.prefab.json");
    expect(made.prefab.root).toBe("set");
    expect(made.prefab.entities.table).toMatchObject({ parent: "set", index: 0 });
    expect(made.prefab.entities.table?.components.transform).toEqual({ position: [-1, 0, -1] });
    expect(made.prefab.entities.chair?.components.transform).toEqual({ position: [1, 0, 1] });
    expect(made.ops.at(-1)).toMatchObject({
      op: "add",
      id: "set",
      entity: { components: { transform: { position: [3, 0, 1] } } },
    });
    expect(() => makePrefab(SCENE, ["cup", "chair"], "Bad", "b.prefab.json")).toThrow(EditError);
    expect(() => makePrefab(SCENE, [], "None", "c.prefab.json")).toThrow(EditError);
  });

  it("gives the path of a prefab from the folder of the scene", () => {
    expect(relativePath("scenes/main.scene.json", "prefabs/desk.prefab.json")).toBe("../prefabs/desk.prefab.json");
    expect(relativePath("main.scene.json", "prefabs/desk.prefab.json")).toBe("prefabs/desk.prefab.json");
    expect(relativePath("scenes/a/b.scene.json", "scenes/c.prefab.json")).toBe("../c.prefab.json");
  });
});

describe("the edits inside an instance", () => {
  const doc = {
    format: "scenity.scene/1",
    id: "room",
    entities: {
      desk: {
        parent: null,
        index: 0,
        components: {
          prefab: { source: "desk.prefab.json", overrides: [{ op: "set", path: "/entities/cup/name", value: "Mug" }] },
        },
      },
      lamp: { parent: null, index: 1, components: {} },
    },
  } as unknown as SceneDocument;

  it("become overrides of the instance: a rename, a hide and a move by the gizmo", () => {
    const ops = routeOverrides(doc, [
      { op: "set", path: "/entities/desk~1cup/name", value: "Big mug" },
      { op: "set", path: "/entities/desk~1table/components/visibility", value: { visible: false } },
      { op: "set", path: "/entities/desk~1table/components/transform/position", value: [1, 0, 0] },
      { op: "set", path: "/entities/lamp/name", value: "Lamp" },
    ]);
    expect(ops).toEqual([
      { op: "set", path: "/entities/lamp/name", value: "Lamp" },
      {
        op: "set",
        path: "/entities/desk/components/prefab/overrides",
        value: [
          { op: "set", path: "/entities/cup/name", value: "Big mug" },
          { op: "set", path: "/entities/table/components/visibility", value: { visible: false } },
          { op: "set", path: "/entities/table/components/transform/position", value: [1, 0, 0] },
        ],
      },
    ]);
    // A path with no escape of the "/" of the ID gives the same override.
    expect(routeOverrides(doc, [{ op: "set", path: "/entities/desk/cup/name", value: "Cup" }])).toEqual([
      {
        op: "set",
        path: "/entities/desk/components/prefab/overrides",
        value: [{ op: "set", path: "/entities/cup/name", value: "Cup" }],
      },
    ]);
    expect(() => routeOverrides(doc, [{ op: "set", path: "/entities/desk~1inner~1leg/name", value: "x" }])).toThrow(
      EditError,
    );
  });
});

// A door prefab in prefabs/, and a variant of it in prefabs/doors/.
const DOOR = {
  format: "scenity.prefab/1",
  id: "door",
  name: "Door",
  root: "frame",
  entities: {
    frame: { name: "Frame", parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
    panel: {
      name: "Panel",
      parent: "frame",
      index: 0,
      components: { transform: { position: [0, 1, 0] }, shape: { kind: "box" } },
    },
  },
} as unknown as PrefabDocument;

describe("prefab variants and nested prefabs", () => {
  it("a variant of a door prefab overrides one part", () => {
    const tint = { op: "set", path: "/entities/panel/components/shape/kind", value: "cylinder" } as const;
    const variant = makeVariant("Round door", "../door.prefab.json", [tint]);
    expect(variant.root).toBe("round-door");
    const scene = {
      format: "scenity.scene/1",
      id: "hall",
      entities: {
        entry: {
          parent: null,
          index: 0,
          components: {
            transform: { position: [1, 0, 0] },
            prefab: { source: "../prefabs/doors/round-door.prefab.json" },
          },
        },
        back: { parent: null, index: 1, components: { prefab: { source: "../prefabs/door.prefab.json" } } },
      },
    } as unknown as SceneDocument;
    const set = { "prefabs/door.prefab.json": DOOR, "prefabs/doors/round-door.prefab.json": variant };
    const { doc, report } = expandPrefabs(scene, prefabSetResolver(set, "scenes/hall.scene.json"), registry);
    expect(report).toEqual([]);
    // The variant changes only its panel. The base door keeps its own panel.
    expect(doc.entities["entry/round-door/panel"]?.components.shape).toEqual({ kind: "cylinder" });
    expect(doc.entities["entry/round-door/frame"]?.components.shape).toBeUndefined();
    expect(doc.entities["back/panel"]?.components.shape).toEqual({ kind: "box" });
  });

  it("a nested instance keeps its prefab file when the prefab goes into another folder", () => {
    expect(
      rebasedSource("../prefabs/door.prefab.json", "scenes/hall.scene.json", "prefabs/rooms/hall.prefab.json"),
    ).toBe("../door.prefab.json");
    expect(rebasedSource("asset:01DOOR", "scenes/hall.scene.json", "prefabs/hall.prefab.json")).toBe("asset:01DOOR");
    const scene = {
      format: "scenity.scene/1",
      id: "hall",
      entities: {
        wall: { name: "Wall", parent: null, index: 0, components: {} },
        door: { parent: "wall", index: 0, components: { prefab: { source: "../prefabs/door.prefab.json" } } },
      },
    } as unknown as SceneDocument;
    const rebase = (source: string) =>
      rebasedSource(source, "scenes/hall.scene.json", "prefabs/rooms/wall.prefab.json");
    const made = makePrefab(scene, ["wall"], "Wall", "../prefabs/rooms/wall.prefab.json", rebase);
    expect(made.prefab.entities.door?.components.prefab).toEqual({ source: "../door.prefab.json" });
  });
});
