// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createRegistry, defineComponent, readDocument, writeDocument } from "../src/index";
import { z } from "zod";
import { CURRENT_FIXTURES, fixtureText } from "./helpers";

describe("readDocument and writeDocument", () => {
  test.each(CURRENT_FIXTURES)("%s: read then write gives the same bytes", (name) => {
    const text = fixtureText(name);
    const result = readDocument(text);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.migrated).toBe(false);
    expect(writeDocument(result.doc)).toBe(text);
  });

  test("there are fixtures of each kind", () => {
    const kinds = CURRENT_FIXTURES.map(
      (name) => /\.(scene|prefab|overrides|project|sequence|material)\.json$/.exec(name)?.[1],
    );
    expect(new Set(kinds)).toEqual(new Set(["scene", "prefab", "overrides", "project", "sequence", "material"]));
  });

  test("an error names the JSON Pointer of the bad value", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as {
      entities: { cart: { components: { transform: { position: unknown[] } } } };
    };
    doc.entities.cart.components.transform.position[0] = "far";
    const result = readDocument(JSON.stringify(doc), "scene");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe("/entities/cart/components/transform/position/0");
    expect(result.errors[0]?.message).toContain("expected number");
  });

  test("an unknown key names its path", () => {
    const result = readDocument('{"format":"scenity.project/1","id":"p","name":"P","scenes":[],"colour":1}');
    expect(result.ok ? [] : result.errors).toEqual([{ path: "/colour", message: 'Unrecognized key: "colour"' }]);
  });

  test("a tree error names its path", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as {
      entities: Record<string, { parent: string | null; index: number }>;
    };
    doc.entities.lamp!.parent = "ghost";
    const result = readDocument(JSON.stringify(doc), "scene");
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toContain("/entities/lamp/parent");
  });

  test("a gap in the indexes is an error", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as { entities: Record<string, { index: number }> };
    doc.entities.front!.index = 2;
    const result = readDocument(JSON.stringify(doc), "scene");
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual(["/entities/front/index"]);
  });
});

describe("readDocument: components", () => {
  test("a site component in the components map is an error", () => {
    const doc = JSON.parse(fixtureText("main.scene.json")) as {
      entities: Record<string, { components: Record<string, unknown> }>;
    };
    doc.entities.front!.components.tags = ["x"];
    const result = readDocument(JSON.stringify(doc), "scene");
    expect(result.ok ? "" : result.errors[0]?.message).toContain("entity field");
  });

  test("text that is not JSON, a bad format and an unexpected kind are errors at a path", () => {
    expect(readDocument("{ nope")).toMatchObject({ ok: false, errors: [{ path: "" }] });
    expect(readDocument('{"format":"scene/1"}')).toMatchObject({ ok: false, errors: [{ path: "/format" }] });
    const wrong = readDocument(fixtureText("empty.project.json"), "scene");
    expect(wrong).toMatchObject({ ok: false, errors: [{ path: "/format" }] });
  });

  test("an unknown component stays as opaque data with a warning, and round-trips", () => {
    const text = fixtureText("workshop.scene.json");
    const result = readDocument(text, "scene");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.warnings).toEqual([
      {
        path: "/entities/drill/components/shop.device",
        message: 'unknown component "shop.device": the value stays as it is',
      },
    ]);
    expect(result.doc.entities.drill?.components["shop.device"]).toEqual({ kind: "drill" });
    expect(writeDocument(result.doc)).toBe(text);
  });

  test("a plugin component in the registry is checked", () => {
    const device = defineComponent({
      id: "shop.device",
      schema: z.strictObject({ kind: z.enum(["drill", "screen"]) }),
      editor: { label: "Device", fields: {} },
    });
    const registry = createRegistry().register(device);
    const good = readDocument(fixtureText("workshop.scene.json"), "scene", { registry });
    expect(good.ok && good.warnings.some((item) => item.path.includes("shop.device"))).toBe(false);
    const bad = fixtureText("workshop.scene.json").replace('"kind": "drill"', '"kind": "toaster"');
    const result = readDocument(bad, "scene", { registry });
    expect(result.ok ? "" : result.errors[0]?.path).toBe("/entities/drill/components/shop.device/kind");
  });
});
