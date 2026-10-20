// SPDX-License-Identifier: Apache-2.0
// The presets of the person. A saved light preset applies to a second light as one step. An entity preset is a create
// command with the components of the entity (no transform). The storage keeps the presets.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "bun:test";
import {
  createCommandRegistry,
  makeUserPreset,
  readUserPresets,
  userPresetCommands,
  userPresetId,
  writeUserPresets,
  type CommandHost,
  type ComponentCommandState,
  type HierarchyState,
  type SceneEditOp,
} from "../src/index";

const registry = builtinRegistry();

function showroom(): SceneDocument {
  const text = readFileSync(join(import.meta.dir, "../../../samples/showroom/scenes/main.scene.json"), "utf8");
  const result = readDocument(text, "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The document after the ops of an outcome. */
function applied(doc: SceneDocument, outcome: { kind: string; ops?: readonly SceneEditOp[] }): SceneDocument {
  if (outcome.kind !== "edit" || outcome.ops === undefined) throw new Error("not an edit");
  const result = applyOps(
    doc,
    outcome.ops.map((op) => op.op),
    registry,
  );
  if (!result.ok) throw new Error(result.reason);
  return result.doc;
}

describe("the presets of the person", () => {
  it("a saved light preset applies to a second light", () => {
    const doc = showroom();
    const preset = makeUserPreset(doc, "lantern-light", "Warm lamp", [], "light");
    expect(preset).toMatchObject({ id: "warmLamp", component: "light" });
    const commands = createCommandRegistry<ComponentCommandState, CommandHost, SceneEditOp>();
    commands.register(userPresetCommands([preset]).apply);
    const state: ComponentCommandState = { doc, registry, selection: { kind: "entity", id: "sun" } };
    const after = applied(doc, commands.prepare("preset.apply.warmLamp", {}, state));
    expect(after.entities.sun?.components.light).toEqual(doc.entities["lantern-light"]?.components.light);
    // An entity with no light gets one; the same values again are a refusal.
    const table = applied(
      after,
      commands.prepare("preset.apply.warmLamp", { entity: "table" }, { ...state, doc: after }),
    );
    expect(table.entities.table?.components.light).toEqual(preset.components.light);
    expect(() => commands.prepare("preset.apply.warmLamp", {}, { ...state, doc: after })).toThrow("the same");
  });

  it("an entity preset is a create command with the components of the entity, with no transform", () => {
    const doc = showroom();
    const preset = makeUserPreset(doc, "sun", "Sun", []);
    expect(Object.keys(preset.components)).not.toContain("transform");
    const commands = createCommandRegistry<HierarchyState, CommandHost, SceneEditOp>();
    commands.register(userPresetCommands([preset]).create);
    const state: HierarchyState = { doc, view: { solo: [], locked: [] }, selection: null };
    const after = applied(doc, commands.prepare("entity.create.user.sun", { x: 2 }, state));
    const added = Object.keys(after.entities).find((id) => !Object.hasOwn(doc.entities, id)) ?? "";
    expect(after.entities[added]?.components.light).toEqual(doc.entities.sun?.components.light);
    expect((after.entities[added]?.components.transform as { position: number[] }).position).toEqual([2, 0, 0]);
  });

  it("gives each preset its own ID, and the storage keeps the presets", () => {
    const warm = { id: "warmLamp", name: "Warm lamp", components: {} };
    expect(userPresetId("Warm lamp", [warm])).toBe("warmLamp2");
    expect(userPresetId("3 point rig", [])).toBe("preset3PointRig");
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    expect(writeUserPresets(storage, [warm])).toBe(true);
    expect(readUserPresets(storage)).toEqual([warm]);
    items.set("scenity.presets.user", '[{"id":"Bad id","name":"x","components":{}}, 3]');
    expect(readUserPresets(storage)).toEqual([]);
    expect(readUserPresets(null)).toEqual([]);
    expect(() => makeUserPreset(showroom(), "table", "No light", [], "light")).toThrow("no light component");
  });
});
