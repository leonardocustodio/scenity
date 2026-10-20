// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentJsonSchemas, jsonSchemaFiles, parseFormat } from "../src/index";
import { CURRENT_FIXTURES, fixtureText } from "./helpers";
import { validate } from "./jsonSchemaSubset";

const SCHEMA_DIR = join(import.meta.dir, "..", "schema");

describe("the JSON Schema export", () => {
  test("the committed schema files are current (bun packages/scene/scripts/json-schema.ts)", () => {
    for (const [name, text] of Object.entries(jsonSchemaFiles())) {
      expect(readFileSync(join(SCHEMA_DIR, name), "utf8")).toBe(text);
    }
  });

  test.each(CURRENT_FIXTURES)("the JSON Schema accepts %s", (name) => {
    const doc = JSON.parse(fixtureText(name)) as { format: string };
    const kind = parseFormat(doc.format)?.kind as keyof ReturnType<typeof documentJsonSchemas>;
    expect(validate(documentJsonSchemas()[kind], doc)).toEqual([]);
  });

  test("the JSON Schema refuses a bad value of a known component", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as {
      entities: { lamp: { components: { light: { type: string } } } };
    };
    doc.entities.lamp.components.light.type = "laser";
    const errors = validate(documentJsonSchemas().scene, doc);
    expect(errors.join("\n")).toContain("/entities/lamp/components/light/type");
  });

  test("the JSON Schema refuses a bad entity ID and an unknown top field", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as Record<string, unknown>;
    doc.extra = 1;
    (doc.entities as Record<string, unknown>)["bad id"] = { parent: null, index: 2, components: {} };
    expect(validate(documentJsonSchemas().scene, doc).length).toBeGreaterThanOrEqual(2);
  });
});
