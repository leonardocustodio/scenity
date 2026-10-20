// SPDX-License-Identifier: Apache-2.0
// The material editor model:
// - the fields of each type from the schema;
// - the edits of a material document (a value, the type, a texture slot and its settings);
// - the assignment of a material asset to a part of an entity as one scene op;
// - the material channel in the one history with the scene (an undo restores both), the live change of a drag as one
//   step, the runtime documents of each change and the file state of a save.
import { describe, expect, it } from "bun:test";
import { builtinRegistry, writeDocument, type SceneDocument } from "@scenity/scene";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import {
  assignMaterialOps,
  EditError,
  MATERIAL_CHANNEL,
  MaterialChannel,
  materialFields,
  materialFileName,
  materialSlots,
  materialTargets,
  materialUsers,
  materialValue,
  renamedMaterial,
  SceneChannel,
  setMaterialMap,
  setMaterialMapSetting,
  setMaterialType,
  setMaterialValue,
  type MaterialEdits,
} from "../src/index";

const STEEL = "asset:01M51H7Y9ZE026AZ1AQJ288Y3V";
const GOLD = "asset:01M51H7YPA8877BCJGSJN1D0B2";
const CHECKER = "asset:01M51H7Y1XMRMVK5YYEV7E6Z79";

const PHYSICAL: MaterialDocument = {
  format: "scenity.material/1",
  type: "physical",
  name: "Blue coat",
  colour: "#2a6fdb",
  roughness: 0.55,
  clearcoat: 1,
  sheenColour: "#ffd2a8",
  maps: { colour: { texture: CHECKER, repeat: [2, 1] }, metalness: { texture: CHECKER } },
};

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "materials",
  entities: {
    ball: { parent: null, index: 0, components: { shape: { kind: "sphere", material: STEEL } } },
    toy: {
      parent: null,
      index: 1,
      components: { model: { asset: "asset:01M519A7ZRK5PTXKJ326T9J6GZ", materials: { Blue: { colour: "#3a8fe0" } } } },
    },
    lamp: { parent: null, index: 2, components: { light: { type: "point" } } },
  },
};

describe("the fields of the material editor", () => {
  it("gives the fields of each type with widgets from the schema", () => {
    const keys = (type: Parameters<typeof materialFields>[0]) => materialFields(type).map((field) => field.key);
    expect(keys("unlit")).toEqual(["colour", "opacity", "alphaTest", "side"]);
    expect(keys("phong")).toContain("shininess");
    expect(keys("standard")).not.toContain("clearcoat");
    const physical = materialFields("physical");
    const field = (key: string) => physical.find((item) => item.key === key);
    expect(field("colour")).toMatchObject({ label: "Colour", group: "Surface", widget: { kind: "colour" } });
    expect(field("roughness")?.widget).toMatchObject({ kind: "number", min: 0, max: 1 });
    expect(field("ior")).toMatchObject({ label: "IOR", widget: { kind: "number", min: 1, max: 2.333 } });
    expect(field("side")?.widget).toEqual({ kind: "enum", options: ["front", "back", "double"] });
    expect(field("normalScale")?.widget).toMatchObject({ kind: "vector", size: 2 });
    expect(field("flatShading")?.widget).toEqual({ kind: "boolean" });
    expect(materialSlots("unlit")).toEqual(["colour", "occlusion", "alpha"]);
    expect([materialValue(PHYSICAL, "roughness"), materialValue(PHYSICAL, "metalness")]).toEqual([0.55, 0]);
  });
});

describe("the edits of a material document", () => {
  it("sets and removes a value, and refuses a value that the schema refuses", () => {
    const rough = setMaterialValue(PHYSICAL, "roughness", 0.2);
    expect(rough.roughness).toBe(0.2);
    expect(PHYSICAL.roughness).toBe(0.55);
    expect("clearcoat" in setMaterialValue(PHYSICAL, "clearcoat", undefined)).toBe(false);
    expect(() => setMaterialValue(PHYSICAL, "roughness", 2)).toThrow(EditError);
    expect(() => setMaterialValue(PHYSICAL, "shininess", 10)).toThrow("has no shininess");
    expect(() => setMaterialValue(PHYSICAL, "maps", {})).toThrow("own edit");
  });

  it("a new type keeps only its fields and its slots", () => {
    const phong = setMaterialType(PHYSICAL, "phong");
    expect(phong).toEqual({
      format: "scenity.material/1",
      type: "phong",
      name: "Blue coat",
      colour: "#2a6fdb",
      maps: { colour: { texture: CHECKER, repeat: [2, 1] } },
    });
    expect(setMaterialValue(phong, "type", "standard").type).toBe("standard");
    expect(() => setMaterialType(PHYSICAL, "glass" as never)).toThrow("not a material type");
  });

  it("sets a texture slot and its settings, and removes the slot", () => {
    const normal = setMaterialMap(PHYSICAL, "normal", CHECKER);
    expect(normal.maps?.normal).toEqual({ texture: CHECKER });
    const swapped = setMaterialMap(PHYSICAL, "colour", "asset:01M51H7Y5WR34JDGZ6BAJ9SRFM");
    expect(swapped.maps?.colour).toEqual({ texture: "asset:01M51H7Y5WR34JDGZ6BAJ9SRFM", repeat: [2, 1] });
    const linear = setMaterialMapSetting(normal, "normal", "colorSpace", "linear");
    expect(linear.maps?.normal?.colorSpace).toBe("linear");
    expect(setMaterialMapSetting(linear, "colour", "offset", [0.5, 0]).maps?.colour?.offset).toEqual([0.5, 0]);
    expect(setMaterialMapSetting(linear, "colour", "repeat", undefined).maps?.colour).toEqual({ texture: CHECKER });
    expect(() => setMaterialMapSetting(PHYSICAL, "normal", "repeat", [1, 1])).toThrow("no normal map");
    expect(() => setMaterialMap(setMaterialType(PHYSICAL, "unlit"), "normal", CHECKER)).toThrow("no normal map");
    const bare = setMaterialMap(setMaterialMap(PHYSICAL, "colour", null), "metalness", null);
    expect("maps" in bare).toBe(false);
  });

  it("names a new material and its file", () => {
    expect(renamedMaterial(PHYSICAL, "  Red paint ").name).toBe("Red paint");
    expect(materialFileName("Red paint (copy)")).toBe("red-paint-copy.material.json");
    expect(materialFileName("  ")).toBe("material.material.json");
  });
});

describe("the assignment of a material asset to a part", () => {
  it("lists the parts of a shape and of a model", () => {
    expect(materialTargets(SCENE, "ball")).toEqual([{ key: null, label: "Shape", material: STEEL }]);
    const parts = { meshes: ["Orange_Object"], materials: ["Blue", "Orange"] };
    expect(materialTargets(SCENE, "toy", parts).map((target) => target.key)).toEqual([
      "Blue",
      "mesh:Orange_Object",
      "Orange",
    ]);
    expect(materialTargets(SCENE, "lamp")).toEqual([]);
  });

  it("assigns a material asset as one scene op that replaces the override of the part", () => {
    const registry = builtinRegistry();
    const channel = new SceneChannel({ doc: SCENE, registry, patch: () => undefined });
    channel.edit(assignMaterialOps(SCENE, "toy", "mesh:Orange_Object", STEEL), "Assign");
    channel.edit(assignMaterialOps(channel.doc, "toy", "Blue", STEEL), "Assign");
    const model = channel.doc.entities.toy?.components.model as { materials: Record<string, unknown> };
    expect(model.materials).toEqual({ Blue: { material: STEEL }, "mesh:Orange_Object": { material: STEEL } });
    expect(materialUsers(channel.doc, STEEL)).toEqual(["ball", "toy"]);
    channel.edit(assignMaterialOps(channel.doc, "ball", null, GOLD), "Assign");
    expect(materialUsers(channel.doc, GOLD)).toEqual(["ball"]);
    expect(channel.undo()).toBe(true);
    expect(materialUsers(channel.doc, GOLD)).toEqual([]);
    const cleared = assignMaterialOps(channel.doc, "ball", null, null);
    expect(cleared).toEqual([{ op: "set", path: "/entities/ball/components/shape/material" }]);
    expect(() => assignMaterialOps(SCENE, "lamp", "Blue", STEEL)).toThrow("no model");
    expect(() => assignMaterialOps(SCENE, "toy", "a/b", STEEL)).toThrow("not a part name");
  });
});

/** A scene channel with a material channel in its history, and the documents that went to the runtime. */
function editorWithMaterials() {
  const sent: MaterialEdits[] = [];
  const materials = new MaterialChannel({ send: (docs) => sent.push(docs) });
  const scene = new SceneChannel({
    doc: SCENE,
    registry: builtinRegistry(),
    patch: () => undefined,
    channels: { [MATERIAL_CHANNEL]: materials.channel },
  });
  materials.connect(scene.history);
  const text = `${JSON.stringify(PHYSICAL)}\n`;
  materials.open(STEEL, "assets/materials/steel.material.json", text);
  return { scene, materials, sent };
}

describe("the material channel", () => {
  it("a change is one step, goes to the runtime, and an undo restores the scene and the material", () => {
    const { scene, materials, sent } = editorWithMaterials();
    scene.edit(assignMaterialOps(SCENE, "toy", "Blue", STEEL), "Assign");
    materials.set(STEEL, setMaterialValue(materials.doc(STEEL), "roughness", 0.1));
    expect(sent.at(-1)?.[STEEL]?.roughness).toBe(0.1);
    expect(materials.dirtyRefs()).toEqual([STEEL]);
    expect(scene.history.steps().steps.map((step) => step.label?.title ?? "start")).toEqual([
      "start",
      "Assign",
      "material",
    ]);
    expect(scene.undo()).toBe(true);
    // The material has no edit at this step, so the runtime gets the document of the file again.
    expect(sent.at(-1)?.[STEEL]?.roughness).toBe(0.55);
    expect(materials.dirty(STEEL)).toBe(false);
    expect(scene.undo()).toBe(true);
    expect(materialUsers(scene.doc, STEEL)).toEqual(["ball"]);
    expect(scene.redo() && scene.redo()).toBe(true);
    expect(materials.doc(STEEL).roughness).toBe(0.1);
  });

  it("a live change shows each value and keeps its end as one step", () => {
    const { scene, materials, sent } = editorWithMaterials();
    materials.begin();
    for (const value of [0.4, 0.3, 0.2])
      materials.set(STEEL, setMaterialValue(materials.doc(STEEL), "roughness", value));
    materials.end();
    expect(sent.map((docs) => docs[STEEL]?.roughness)).toEqual([0.4, 0.3, 0.2]);
    expect(scene.history.steps().steps).toHaveLength(2);
    expect(scene.undo()).toBe(true);
    expect(materials.doc(STEEL).roughness).toBe(0.55);
    // A cancelled drag restores the start values and makes no step.
    materials.begin();
    materials.set(STEEL, setMaterialValue(materials.doc(STEEL), "roughness", 0.9));
    materials.end(true);
    expect(materials.doc(STEEL).roughness).toBe(0.55);
    expect(sent.at(-1)?.[STEEL]?.roughness).toBe(0.55);
    expect(scene.history.steps().steps).toHaveLength(2);
  });

  it("gives the save request of the canonical text, and a good save is the new base", () => {
    const { materials } = editorWithMaterials();
    materials.set(STEEL, setMaterialValue(materials.doc(STEEL), "colour", "#ff0000"));
    const request = materials.saveRequest(STEEL);
    expect(request.path).toBe("assets/materials/steel.material.json");
    expect(request.text).toBe(writeDocument(materials.doc(STEEL)));
    expect(request.baseHash).toMatch(/^[0-9a-f]{64}$/);
    materials.saved(STEEL, { ok: true, path: request.path, text: request.text, hash: "a".repeat(64) });
    expect(materials.dirty(STEEL)).toBe(false);
    expect(materials.saveRequest(STEEL).baseHash).toBe("a".repeat(64));
    expect(() => materials.doc(GOLD)).toThrow("not open");
    expect(() => materials.open(GOLD, "gold.material.json", "{")).toThrow("does not read");
  });
});
