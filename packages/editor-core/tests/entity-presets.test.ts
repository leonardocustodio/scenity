// SPDX-License-Identifier: Apache-2.0
// The create presets: each command `entity.create.<preset>` adds one entity with the components of its preset. The
// components pass the checks of the built-in components.
import { applyOps, builtinRegistry } from "@scenity/scene";
import { describe, expect, it } from "bun:test";
import {
  createCommandRegistry,
  ENTITY_PRESETS,
  PRESET_COMMANDS,
  type CommandHost,
  type HierarchyState,
  type SceneEditOp,
} from "../src/index";
import { garden } from "./helpers";

const registry = builtinRegistry();
const commands = createCommandRegistry<HierarchyState, CommandHost, SceneEditOp>();
commands.register(PRESET_COMMANDS);

describe("the create presets", () => {
  it("adds one entity for each preset, and the document stays valid", () => {
    const doc = garden();
    const state: HierarchyState = { doc, view: { solo: [], locked: [] }, selection: null };
    // The presets with an input get a prefab of the scene and a model of the garden.
    const inputs: Readonly<Record<string, string>> = { source: "prefabs/lamp.prefab.json", asset: "asset:01HMODEL" };
    for (const preset of ENTITY_PRESETS) {
      const input = preset.input === undefined ? {} : { [preset.input.arg]: inputs[preset.input.arg] };
      const outcome = commands.prepare(`entity.create.${preset.id}`, { x: 1, y: 2, ...input }, state);
      if (outcome.kind !== "edit") throw new Error("not an edit");
      const applied = applyOps(
        doc,
        outcome.ops.map((op) => op.op),
        registry,
      );
      expect(applied.ok ? "" : `${preset.id}: ${applied.reason}`).toBe("");
      if (!applied.ok) continue;
      const added = Object.keys(applied.doc.entities).find((id) => !Object.hasOwn(doc.entities, id)) ?? "";
      const entity = applied.doc.entities[added];
      expect(entity?.name).toBe(preset.name);
      const fromInput = { prefab: ["prefab"], character: ["model", "character"] }[preset.id] ?? [];
      expect(Object.keys(entity?.components ?? {}).sort()).toEqual(
        ["transform", ...Object.keys(preset.components), ...fromInput].sort(),
      );
    }
  });

  it("takes a name and a parent, and refuses a parent that is not there", () => {
    const doc = garden();
    const state: HierarchyState = { doc, view: { solo: [], locked: [] }, selection: null };
    const outcome = commands.prepare("entity.create.pointLight", { name: "Desk lamp" }, state);
    expect(outcome.title).toBe("Create Desk lamp");
    expect(() => commands.prepare("entity.create.box", { parent: "nobody" }, state)).toThrow('No entity "nobody"');
  });

  it("a preset with an input refuses a run with no valid input; yaw and pitch turn the new entity", () => {
    const doc = garden();
    const state: HierarchyState = { doc, view: { solo: [], locked: [] }, selection: null };
    expect(() => commands.prepare("entity.create.prefab", {}, state)).toThrow('Prefab instance needs "source"');
    expect(() => commands.prepare("entity.create.prefab", { source: "lamp.json" }, state)).toThrow("no prefab source");
    expect(() => commands.prepare("entity.create.character", { asset: "a b" }, state)).toThrow("no asset reference");
    const outcome = commands.prepare("entity.create.camera", { yaw: 90, pitch: -30 }, state);
    if (outcome.kind !== "edit") throw new Error("not an edit");
    const op = outcome.ops[0]?.op;
    const rotation = op?.op === "add" ? (op.entity.components.transform as { rotation?: number[] }).rotation : null;
    // A quarter turn about Y, then a tilt of 30° down about X.
    const [s30, c30] = [Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)];
    const half = Math.SQRT1_2;
    const expected = [-half * s30, half * c30, half * s30, half * c30];
    rotation?.forEach((value, at) => expect(value).toBeCloseTo(expected[at] ?? 0, 5));
    expect(rotation).toHaveLength(4);
    expect(commands.prepare("entity.create.audioSource", {}, state).title).toBe("Create Audio source");
  });
});
