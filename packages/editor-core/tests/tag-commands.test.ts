// SPDX-License-Identifier: Apache-2.0
// The tags and the pick layers: the lists with their entities, and a rename across the scene as one edit. A new name
// that an entity has already merges into it.
import { applyOps, builtinRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "bun:test";
import {
  createCommandRegistry,
  layerUses,
  TAG_COMMANDS,
  tagUses,
  type CommandHost,
  type HierarchyState,
  type SceneEditOp,
} from "../src/index";

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    chair: { parent: null, index: 0, tags: ["wood", "seat"], components: { pickable: { layers: ["props"] } } },
    table: { parent: null, index: 1, tags: ["wood"], components: {} },
    stool: { parent: null, index: 2, tags: ["oak", "seat"], components: { pickable: { layers: ["props", "x"] } } },
  },
} as unknown as SceneDocument;

const commands = createCommandRegistry<HierarchyState, CommandHost, SceneEditOp>();
commands.register(TAG_COMMANDS);
const state: HierarchyState = { doc: DOC, view: { solo: [], locked: [] }, selection: null };

describe("the tags and the pick layers", () => {
  it("list each name with its entities", () => {
    expect(tagUses(DOC)).toEqual([
      { name: "oak", entities: ["stool"] },
      { name: "seat", entities: ["chair", "stool"] },
      { name: "wood", entities: ["chair", "table"] },
    ]);
    expect(layerUses(DOC).map((use) => [use.name, use.entities.length])).toEqual([
      ["props", 2],
      ["x", 1],
    ]);
  });

  it("rename a tag and a pick layer on each entity in one edit", () => {
    const outcome = commands.prepare("tag.rename", { from: "wood", to: "oak" }, state);
    if (outcome.kind !== "edit") throw new Error("not an edit");
    const applied = applyOps(
      DOC,
      outcome.ops.map((op) => op.op),
      builtinRegistry(),
    );
    if (!applied.ok) throw new Error(applied.reason);
    expect(applied.doc.entities.chair?.tags).toEqual(["oak", "seat"]);
    expect(applied.doc.entities.table?.tags).toEqual(["oak"]);
    expect(tagUses(applied.doc).map((use) => use.name)).toEqual(["oak", "seat"]);
    const layer = commands.prepare("pickLayer.rename", { from: "props", to: "x" }, state);
    if (layer.kind !== "edit") throw new Error("not an edit");
    expect(layer.ops.map((op) => op.op)).toEqual([
      { op: "set", path: "/entities/chair/components/pickable/layers", value: ["x"] },
      { op: "set", path: "/entities/stool/components/pickable/layers", value: ["x"] },
    ]);
    expect(() => commands.prepare("tag.rename", { from: "none", to: "y" }, state)).toThrow(
      'No entity has the tag "none"',
    );
    expect(() => commands.prepare("tag.rename", { from: "wood", to: "a b" }, state)).toThrow("is no tag");
  });
});
