// SPDX-License-Identifier: Apache-2.0
// The scene op of a promote on the generic garden scene: one `add` op of an entity with a `model` component of the new
// asset at the place of the scratch model, with the turn about Y. The ID is a free ID from the name. The scene channel
// applies the op as one step of the history, and an undo restores the document.
import { describe, expect, it } from "bun:test";
import { builtinRegistry, writeDocument } from "@scenity/scene";
import { applyOps } from "@scenity/scene/ops";
import { promotedName, promoteEdit, SceneChannel, yawRotation } from "../src/index";
import { garden } from "./helpers";

describe("the promote op", () => {
  it("adds one entity with the model of the asset at the place, turned about Y", () => {
    const doc = garden();
    const edit = promoteEdit(doc, {
      asset: "01PROMOTED",
      name: "Chair (v2)",
      position: [0.5, 0, 1.25],
      yaw: Math.PI / 2,
    });
    expect(edit.roots).toEqual(["chair-v2"]);
    expect(edit.ops).toEqual([
      {
        op: "add",
        id: "chair-v2",
        entity: {
          name: "Chair (v2)",
          parent: null,
          index: Object.values(doc.entities).filter((entity) => entity.parent === null).length,
          components: {
            transform: { position: [0.5, 0, 1.25], rotation: [0, 0.707107, 0, 0.707107] },
            model: { asset: "asset:01PROMOTED" },
          },
        },
      },
    ]);
    const applied = applyOps(doc, edit.ops, builtinRegistry());
    expect(applied.ok).toBe(true);
  });

  it("gives no rotation for no turn, a free ID for a taken name, and the name of a file", () => {
    const doc = garden();
    const first = promoteEdit(doc, { asset: "asset:01A", name: "bench", position: [0, 0, 0] });
    expect(first.roots).toEqual(["bench-2"]);
    const add = first.ops[0];
    expect(add?.op === "add" ? add.entity.components.transform : null).toEqual({ position: [0, 0, 0] });
    expect(yawRotation(Math.PI)).toEqual([0, 1, 0, 0]);
    expect(promotedName("C:\\drops\\Lamp Post.fbx")).toBe("Lamp Post");
    expect(promotedName("models/box.glb")).toBe("box");
    expect(() => promoteEdit(doc, { asset: "not an asset!", position: [0, 0, 0] })).toThrow("asset reference");
  });

  it("is one step of the history: an undo gives the document back, a redo the entity again", () => {
    const doc = garden();
    const channel = new SceneChannel({ doc, registry: builtinRegistry(), patch: () => undefined });
    const before = writeDocument(channel.doc);
    const edit = promoteEdit(channel.doc, { asset: "01PROMOTED", name: "box", position: [1, 0, 2], yaw: 0.3 });
    const result = channel.edit(edit.ops, "Promote box");
    expect(result.applied).toBe(true);
    expect(channel.doc.entities.box?.components.model).toEqual({ asset: "asset:01PROMOTED" });
    expect(channel.undo()).toBe(true);
    expect(writeDocument(channel.doc)).toBe(before);
    expect(channel.redo()).toBe(true);
    expect(Object.hasOwn(channel.doc.entities, "box")).toBe(true);
  });
});
