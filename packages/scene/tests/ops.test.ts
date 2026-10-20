// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  applyTransaction,
  childrenOf,
  escapeToken,
  formatPointer,
  getAt,
  parsePointer,
  transaction,
  type PrefabDocument,
  type SceneDocument,
  type SceneOp,
} from "../src/index";
import { deepFreeze, fixture, registry } from "./helpers";

const scene = deepFreeze(fixture("main.scene.json", "scene"));
const prefab = deepFreeze(fixture("door.prefab.json", "prefab"));

function apply(ops: SceneOp[], doc: SceneDocument | PrefabDocument = scene) {
  return applyOps(doc, ops, registry);
}

function reason(ops: SceneOp[], doc: SceneDocument | PrefabDocument = scene): string {
  const result = apply(ops, doc);
  return result.ok ? "" : result.reason;
}

describe("JSON Pointer (RFC 6901)", () => {
  test("escapes ~ and / and reads them back", () => {
    expect(escapeToken("a/b~c")).toBe("a~1b~0c");
    expect(formatPointer(["entities", "door/leaf", 0])).toBe("/entities/door~1leaf/0");
    expect(parsePointer("/entities/door~1leaf/~01")).toEqual(["entities", "door/leaf", "~1"]);
    expect(parsePointer("")).toEqual([]);
    expect(parsePointer("nope")).toBeUndefined();
    expect(parsePointer("/a~2")).toBeUndefined();
    expect(getAt(scene, ["entities", "cart", "components", "transform", "position", "0"])).toBe(0.85);
    expect(getAt(scene, ["entities", "cart", "tags", "01"])).toBeUndefined();
  });
});

describe("the ops", () => {
  test("set changes one value, shares the rest and gives the inverse", () => {
    const path = "/entities/cart/components/transform/position/0";
    const result = apply([{ op: "set", path, value: 0.9 }]);
    if (!result.ok) throw new Error(result.reason);
    expect(getAt(result.doc, parsePointer(path)!)).toBe(0.9);
    expect(result.doc.entities.front).toBe(scene.entities.front);
    expect(result.inverse).toEqual([{ op: "set", path, value: 0.85 }]);
  });

  test("set with no value removes the key; its inverse puts it back", () => {
    const result = apply([{ op: "set", path: "/entities/cart/name" }]);
    if (!result.ok) throw new Error(result.reason);
    expect("name" in result.doc.entities.cart!).toBe(false);
    expect(result.inverse).toEqual([{ op: "set", path: "/entities/cart/name", value: "Cart" }]);
  });

  test("a set of a bad value is refused with a reason", () => {
    expect(reason([{ op: "set", path: "/entities/cart/components/transform/position/0", value: "x" }])).toContain(
      "/entities/cart/components/transform/position/0",
    );
    expect(reason([{ op: "set", path: "/entities/lamp/components/light/type", value: "laser" }])).toContain(
      "light/type",
    );
    expect(reason([{ op: "set", path: "/entities/cart/name", value: 3 }])).toContain("/entities/cart/name");
    expect(reason([{ op: "set", path: "/environment/exposure", value: -1 }])).toContain("/environment/exposure");
  });

  test("set refuses the paths that other ops own", () => {
    expect(reason([{ op: "set", path: "/entities/cart/parent", value: "front" }])).toContain("use move");
    expect(reason([{ op: "set", path: "/entities/cart/index", value: 1 }])).toContain("use move");
    expect(reason([{ op: "set", path: "/entities/cart", value: {} }])).toContain("add and remove");
    expect(reason([{ op: "set", path: "/entities/cart/components/visibility", value: {} }])).toContain("addComponent");
    expect(reason([{ op: "set", path: "/entities/cart/components/model" }])).toContain("removeComponent");
    expect(reason([{ op: "set", path: "/id", value: "other" }])).toContain("does not change");
    expect(reason([{ op: "set", path: "/entities/ghost/name", value: "G" }])).toContain("does not exist");
    expect(reason([{ op: "set", path: "/entities/cart/components/transform/position/3", value: 1 }])).toContain(
      "no array item",
    );
    expect(reason([{ op: "set", path: "/entities/cart/components/transform/position/0" }])).toContain("array item");
  });

  test("a bad op shape is refused with a reason and the index", () => {
    const result = apply([{ op: "set", path: "/name", value: "A" }, { op: "explode" } as unknown as SceneOp]);
    expect(result).toMatchObject({ ok: false, index: 1 });
  });
});

describe("the tree and component ops", () => {
  test("add puts an entity at an index and moves the later siblings", () => {
    const result = apply([{ op: "add", id: "rug", entity: { parent: null, index: 1, components: {} } }]);
    if (!result.ok) throw new Error(result.reason);
    expect(childrenOf(result.doc.entities, null)).toEqual(["cart", "rug", "front"]);
    expect(result.doc.entities.front?.index).toBe(2);
    expect(result.inverse).toEqual([{ op: "remove", id: "rug" }]);
  });

  test("add refuses a used ID, a missing parent, a gap and a bad component", () => {
    const entity = { parent: null, index: 0, components: {} };
    expect(reason([{ op: "add", id: "cart", entity }])).toContain("exists already");
    expect(reason([{ op: "add", id: "x", entity: { ...entity, parent: "ghost" } }])).toContain("does not exist");
    expect(reason([{ op: "add", id: "x", entity: { ...entity, index: 5 } }])).toContain("above 2");
    expect(reason([{ op: "add", id: "x", entity: { ...entity, components: { light: {} } } }])).toContain("light/type");
    expect(reason([{ op: "add", id: "bad id", entity }])).toContain("/id");
  });

  test("remove takes the subtree; its inverse gives it back", () => {
    const result = apply([{ op: "remove", id: "cart" }]);
    if (!result.ok) throw new Error(result.reason);
    expect(Object.keys(result.doc.entities)).toEqual(["front"]);
    expect(result.doc.entities.front?.index).toBe(0);
    expect(result.inverse.map((op) => op.op)).toEqual(["add", "add"]);
    const back = apply(result.inverse, result.doc);
    expect(back.ok && back.doc).toEqual(scene);
  });

  test("move changes the parent and the index; a cycle is refused", () => {
    const result = apply([{ op: "move", id: "front", parent: "cart", index: 0 }]);
    if (!result.ok) throw new Error(result.reason);
    expect(childrenOf(result.doc.entities, "cart")).toEqual(["front", "lamp"]);
    expect(result.inverse).toEqual([{ op: "move", id: "front", parent: null, index: 1 }]);
    expect(reason([{ op: "move", id: "cart", parent: "lamp", index: 0 }])).toContain("cycle");
    expect(reason([{ op: "move", id: "cart", parent: "cart", index: 0 }])).toContain("cycle");
    expect(reason([{ op: "move", id: "cart", parent: null, index: 2 }])).toContain("above 1");
  });

  test("addComponent and removeComponent check the value and give the inverse", () => {
    const added = apply([{ op: "addComponent", id: "front", component: "annotation", value: { text: "Hi" } }]);
    expect(added.ok && added.inverse).toEqual([{ op: "removeComponent", id: "front", component: "annotation" }]);
    expect(reason([{ op: "addComponent", id: "front", component: "annotation", value: {} }])).toContain(
      "annotation/text",
    );
    expect(reason([{ op: "addComponent", id: "front", component: "camera", value: {} }])).toContain("already");
    expect(reason([{ op: "addComponent", id: "front", component: "tags", value: [] }])).toContain("entity field");
    const removed = apply([{ op: "removeComponent", id: "front", component: "camera" }]);
    expect(removed.ok && removed.inverse).toEqual([
      { op: "addComponent", id: "front", component: "camera", value: { fov: 45, target: [0, 1, 0] } },
    ]);
    expect(reason([{ op: "removeComponent", id: "front", component: "light" }])).toContain("no component");
  });

  test("an unknown component is allowed with a warning", () => {
    const result = apply([{ op: "addComponent", id: "front", component: "doors.door", value: { open: true } }]);
    expect(result.ok && result.warnings).toEqual(['unknown component "doors.door": the value stays as it is']);
  });

  test("a failed list leaves the input as it was", () => {
    const result = apply([
      { op: "set", path: "/entities/cart/name", value: "Trolley" },
      { op: "remove", id: "ghost" },
    ]);
    expect(result).toEqual({ ok: false, index: 1, reason: 'the entity "ghost" does not exist' });
    expect(scene.entities.cart?.name).toBe("Cart");
  });

  test("a prefab keeps one root", () => {
    expect(reason([{ op: "remove", id: "frame" }], prefab)).toContain("root");
    expect(reason([{ op: "move", id: "leaf", parent: null, index: 1 }], prefab)).toContain("one root");
    expect(reason([{ op: "add", id: "x", entity: { parent: null, index: 1, components: {} } }], prefab)).toContain(
      "one root",
    );
    expect(reason([{ op: "set", path: "/root", value: "leaf" }], prefab)).toContain("does not change");
    expect(apply([{ op: "move", id: "handle", parent: "frame", index: 1 }], prefab).ok).toBe(true);
  });
});

describe("transactions", () => {
  test("a transaction is one undo step with one op list", () => {
    const tx = transaction("Move the cart", [
      { op: "set", path: "/entities/cart/components/transform/position/0", value: 1 },
      { op: "set", path: "/entities/cart/components/transform/position/2", value: -2 },
      { op: "add", id: "box", entity: { parent: "cart", index: 1, components: {} } },
    ]);
    const result = applyTransaction(scene, tx, registry);
    if (!result.ok) throw new Error(result.reason);
    expect(result.inverse.label).toBe("Move the cart");
    expect(result.inverse.ops).toHaveLength(3);
    expect(result.inverse.ops[0]).toEqual({ op: "remove", id: "box" });
    const undo = applyTransaction(result.doc, result.inverse, registry);
    expect(undo.ok && undo.doc).toEqual(scene);
  });
});
