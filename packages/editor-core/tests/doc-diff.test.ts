// SPDX-License-Identifier: Apache-2.0
// The ops between two versions of a document. A removed subtree, an added parent with a child, a move, a rename,
// component changes and a value of the scene give ops that make the new version exactly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "bun:test";
import { docOps } from "../src/index";

const registry = builtinRegistry();

function showroom(): SceneDocument {
  const text = readFileSync(join(import.meta.dir, "../../../samples/showroom/scenes/main.scene.json"), "utf8");
  const result = readDocument(text, "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

describe("the ops between two versions of a document", () => {
  it("make the new version: entities that go and come, a move, a rename, components and scene values", () => {
    const prev = showroom();
    // The next version comes from edits, as in the editor.
    const edits = applyOps(
      prev,
      [
        { op: "remove", id: "lantern-light" },
        { op: "remove", id: "lantern" },
        { op: "add", id: "desk", entity: { name: "Desk", parent: null, index: 0, components: {} } },
        { op: "add", id: "pen", entity: { name: "Pen", parent: "desk", index: 0, components: {} } },
        { op: "addComponent", id: "pen", component: "shape", value: { kind: "cylinder" } },
        { op: "move", id: "armchair", parent: "table", index: 0 },
        { op: "set", path: "/entities/armchair/name", value: "Reading chair" },
        { op: "addComponent", id: "armchair", component: "light", value: { type: "point" } },
        { op: "set", path: "/entities/sun/components/light/intensity", value: 3 },
        { op: "removeComponent", id: "shelf", component: "obstacle" },
        { op: "set", path: "/environment/exposure", value: 0.6 },
      ],
      registry,
    );
    if (!edits.ok) throw new Error(edits.reason);
    const next = edits.doc;
    const ops = docOps(prev, next, registry);
    expect(ops).not.toBeNull();
    const result = applyOps(prev, ops ?? [], registry);
    expect(result.ok && JSON.stringify(result.doc) === JSON.stringify(next)).toBe(true);
    expect(ops?.find((op) => op.op === "remove")).toMatchObject({ id: "lantern-light" });
  });

  it("gives no op for the same document", () => {
    const doc = showroom();
    expect(docOps(doc, doc, registry)).toEqual([]);
  });
});
