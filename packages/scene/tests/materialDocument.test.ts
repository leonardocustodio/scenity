// SPDX-License-Identifier: Apache-2.0
// The material document `scenity.material/1`: the reader, the values and the texture slots of each type,
// the texture references and the JSON Schema.
import { describe, expect, test } from "bun:test";
import {
  documentJsonSchemas,
  FORMAT_CHAINS,
  MATERIAL_FIELDS,
  MATERIAL_SLOTS_OF,
  MATERIAL_TYPES,
  materialTextureRefs,
  readDocument,
  type MaterialDocument,
} from "../src/index";
import { fixtureText } from "./helpers";
import { validate } from "./jsonSchemaSubset";

function read(doc: Record<string, unknown>) {
  return readDocument(JSON.stringify({ format: "scenity.material/1", ...doc }), "material");
}

describe("the material document", () => {
  test("the format starts at version 1", () => {
    expect(FORMAT_CHAINS.material.current).toBe(1);
  });

  test("each type reads with its own values and slots", () => {
    for (const type of MATERIAL_TYPES) {
      expect(read({ type, colour: "#ffffff", opacity: 0.5, side: "double" }).ok).toBe(true);
    }
    expect(MATERIAL_FIELDS.unlit).toEqual([]);
    expect(MATERIAL_SLOTS_OF.unlit).toEqual(["colour", "occlusion", "alpha"]);
    expect(read({ type: "phong", specular: "#ffffff", shininess: 30, emissive: "#101010" }).ok).toBe(true);
  });

  test("a value or a slot of another type is an error with its pointer", () => {
    const result = read({
      type: "lambert",
      roughness: 0.5,
      maps: { roughness: { texture: "asset:01J9Z6Q3R8TEX00001" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { path: "/roughness", message: "a lambert material has no roughness" },
      { path: "/maps/roughness", message: "a lambert material has no roughness map" },
    ]);
  });

  test("a texture reference is an asset reference with an optional colour space", () => {
    expect(read({ type: "unlit", maps: { colour: { texture: "chair.png" } } }).ok).toBe(false);
    expect(read({ type: "unlit", maps: { colour: { texture: "asset:01J9Z6Q3R8", colorSpace: "p3" } } }).ok).toBe(false);
    expect(read({ type: "unlit", maps: { glow: { texture: "asset:01J9Z6Q3R8" } } }).ok).toBe(false);
  });

  test("the texture references come one time each, in slot order", () => {
    const result = readDocument(fixtureText("brushed-steel.material.json"), "material");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(materialTextureRefs(result.doc)).toEqual(["asset:01J9Z6Q3R8TEX0000000001", "asset:01J9Z6Q3R8TEX0000000002"]);
    const twice: MaterialDocument = {
      format: "scenity.material/1",
      type: "standard",
      maps: { roughness: { texture: "asset:a" }, metalness: { texture: "asset:a" } },
    };
    expect(materialTextureRefs(twice)).toEqual(["asset:a"]);
  });

  test("the JSON Schema refuses an unknown field and a bad type", () => {
    const schema = documentJsonSchemas().material;
    expect(validate(schema, { format: "scenity.material/1", type: "standard", glow: 1 }).length).toBeGreaterThan(0);
    expect(validate(schema, { format: "scenity.material/1", type: "toon" }).length).toBeGreaterThan(0);
  });
});
