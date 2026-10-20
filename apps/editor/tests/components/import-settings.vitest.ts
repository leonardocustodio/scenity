// SPDX-License-Identifier: Apache-2.0
// The settings form of an importer: the fields of the JSON Schema of its settings, and the settings of an import with
// only the fields that the person changed. Also the fixes of a failed import.
import { describe, expect, it } from "vitest";
import { importFix } from "../../src/assetBrowser/importFixes";
import { formFor, settingFields, settingsValue } from "../../src/assetBrowser/settingsForm";

/** A part of the JSON Schema of the model importer (`z.toJSONSchema` of its settings). */
const SCHEMA = {
  type: "object",
  properties: {
    scale: {
      default: "auto",
      anyOf: [
        { type: "string", const: "auto" },
        { type: "number", exclusiveMinimum: 0 },
      ],
    },
    up: { default: "y", type: "string", enum: ["y", "z"] },
    merge: { default: false, type: "boolean" },
    maxTextureSize: { default: 2048, type: "integer", minimum: 1 },
    decimate: { anyOf: [{ type: "number" }, { type: "object", properties: { ratio: { type: "number" } } }] },
  },
};

describe("the settings form of an importer", () => {
  it("makes a field of each setting, with the fields of more parts apart", () => {
    const fields = settingFields(SCHEMA);
    expect(fields.map((field) => [field.name, field.kind, field.fallback, field.advanced])).toEqual([
      ["scale", "word-or-number", "auto", false],
      ["up", "choice", "y", false],
      ["merge", "boolean", "false", false],
      ["maxTextureSize", "integer", "2048", false],
      ["decimate", "json", "", true],
    ]);
    expect(fields[1]?.choices).toEqual(["y", "z"]);
  });

  it("gives only the changed settings, and refuses a field that does not read", () => {
    const fields = settingFields(SCHEMA);
    expect(settingsValue(fields, {})).toEqual({});
    expect(settingsValue(fields, { scale: "0.01", up: "z", merge: "true", decimate: '{"ratio":0.5}' })).toEqual({
      scale: 0.01,
      up: "z",
      merge: true,
      decimate: { ratio: 0.5 },
    });
    expect(settingsValue(fields, { scale: "auto", up: "y" })).toEqual({});
    expect(() => settingsValue(fields, { decimate: "{" })).toThrow("decimate");
    expect(() => settingsValue(fields, { maxTextureSize: "big" })).toThrow("maxTextureSize");
    expect(formFor([{ name: "gltf", extensions: [".glb", ".gltf"] }], "Chair.GLB")?.name).toBe("gltf");
  });
});

describe("the fixes of the import queue", () => {
  it("gives the doctor fix to an import with no Blender, and no fix to other reasons", () => {
    // The text of NO_BLENDER of `@scenity/assets/blender` (that module runs only in Bun).
    expect(importFix("no Blender: FBX, OBJ and .blend files need Blender 5.2")?.id).toBe("blender");
    expect(importFix('Executable not found in $PATH: "docker"')?.url).toBe("https://www.blender.org/download/");
    expect(importFix("no importer for .xyz")).toBeNull();
    expect(importFix(undefined)).toBeNull();
  });
});
