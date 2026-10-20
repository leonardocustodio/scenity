// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  builtinComponents,
  createRegistry,
  defineComponent,
  eulerRadiansFromQuat,
  FORMAT_CHAINS,
  parseFormat,
  readDocument,
  upcastScene0,
  writeDocument,
} from "../src/index";
import { fixtureText } from "./helpers";

describe("formats and migrations", () => {
  test("parseFormat reads the kind and the major", () => {
    expect(parseFormat("scenity.scene/1")).toEqual({ kind: "scene", version: 1 });
    expect(parseFormat("scenity.scene/01")).toBeUndefined();
    expect(parseFormat("other.scene/1")).toBeUndefined();
    expect(parseFormat(3)).toBeUndefined();
  });

  test("each format chain has an upcaster for each older version", () => {
    for (const chain of Object.values(FORMAT_CHAINS)) {
      for (let version = 0; version < chain.current; version += 1) {
        if (version === 0 && chain.upcasters[0] === undefined) continue;
        expect(typeof chain.upcasters[version]).toBe("function");
      }
    }
  });

  test("upcastScene0 makes the map, the indexes, the quaternions and the environment", () => {
    const out = upcastScene0({
      format: "scenity.scene/0",
      id: "a",
      background: "#101010",
      entities: [
        { id: "x", components: { transform: { rotation: [0, Math.PI / 2, 0] } } },
        { id: "y", parent: "x", components: {} },
        { id: "z", components: {} },
      ],
    });
    expect(out.format).toBe("scenity.scene/1");
    expect(out.environment).toEqual({ background: "#101010" });
    expect("background" in out).toBe(false);
    const entities = out.entities as Record<
      string,
      { parent: string | null; index: number; components: { transform?: { rotation: number[] } } }
    >;
    expect(entities.x).toMatchObject({ parent: null, index: 0 });
    expect(entities.y).toMatchObject({ parent: "x", index: 0 });
    expect(entities.z).toMatchObject({ parent: null, index: 1 });
    const rotation = entities.x?.components.transform?.rotation ?? [];
    expect(rotation[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(rotation[3]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  test("a v0 fixture loads as v1", () => {
    const result = readDocument(fixtureText("legacy.v0.scene.json"), "scene");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.format).toBe("scenity.scene/0");
    expect(result.migrated).toBe(true);
    expect(result.doc.format).toBe("scenity.scene/1");
    expect(Object.keys(result.doc.entities).sort()).toEqual(["key", "table", "vase"]);
    expect(result.doc.entities.vase).toMatchObject({ parent: "table", index: 0 });
    expect(result.doc.environment).toEqual({ background: "#202020" });
    const rotation = (result.doc.entities.table?.components.transform as { rotation: [number, number, number, number] })
      .rotation;
    expect(eulerRadiansFromQuat(rotation)[1]).toBeCloseTo(1.5707963, 6);
    // The migrated document reads again as a v1 document with the same bytes.
    const again = readDocument(writeDocument(result.doc), "scene");
    expect(again.ok && writeDocument(again.doc)).toBe(writeDocument(result.doc));
  });

  test("a v2 file gets a clear refusal", () => {
    const result = readDocument(fixtureText("future.v2.scene.json"));
    expect(result).toEqual({
      ok: false,
      errors: [{ path: "/format", message: "this file has format scenity.scene/2; this Scenity reads up to /1" }],
    });
  });

  test("an unknown kind is refused", () => {
    expect(readDocument('{"format":"scenity.recipe/1"}')).toMatchObject({ ok: false, errors: [{ path: "/format" }] });
  });
});

describe("component versions", () => {
  // A plugin component in version 3. v1 had `open` as a boolean, v2 had `angle` in degrees, and v3 has radians.
  const door = defineComponent({
    id: "doors.door",
    version: 3,
    schema: z.strictObject({ angle: z.number() }),
    editor: { label: "Door", fields: {} },
    migrate: {
      1: (value) => ({ angle: (value as { open: boolean }).open ? 90 : 0 }),
      2: (value) => ({ angle: ((value as { angle: number }).angle * Math.PI) / 180 }),
    },
  });
  const registry = createRegistry([...builtinComponents, door]);
  const scene = (versions: Record<string, number> | undefined, value: unknown) =>
    JSON.stringify({
      format: "scenity.scene/1",
      id: "s",
      entities: { d: { parent: null, index: 0, components: { "doors.door": value } } },
      ...(versions ? { versions } : {}),
    });

  test("the upcaster 1 → 2 changes the boolean into degrees", () => {
    expect(door.migrate[1]?.({ open: true })).toEqual({ angle: 90 });
  });

  test("the upcaster 2 → 3 changes degrees into radians", () => {
    expect((door.migrate[2]?.({ angle: 180 }) as { angle: number }).angle).toBeCloseTo(Math.PI, 12);
  });

  test("a value with no version entry is version 1 and goes through the chain", () => {
    const result = readDocument(scene(undefined, { open: true }), "scene", { registry });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect((result.doc.entities.d?.components["doors.door"] as { angle: number }).angle).toBeCloseTo(Math.PI / 2, 12);
    expect(result.doc.versions).toEqual({ "doors.door": 3 });
    expect(result.migrated).toBe(true);
  });

  test("a current value stays as it is", () => {
    const result = readDocument(scene({ "doors.door": 3 }, { angle: 1 }), "scene", { registry });
    expect(result.ok && result.migrated).toBe(false);
  });

  test("a newer component version is refused at its path", () => {
    const result = readDocument(scene({ "doors.door": 4 }, { angle: 1 }), "scene", { registry });
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: "/entities/d/components/doors.door",
          message: 'the component "doors.door" has version 4; this Scenity reads up to 3',
        },
      ],
    });
  });

  test("the version of an unknown component stays in the document", () => {
    const result = readDocument(scene({ "doors.door": 7 }, { any: 1 }), "scene");
    expect(result.ok && result.doc.versions).toEqual({ "doors.door": 7 });
  });

  test("defineComponent refuses a gap in the chain", () => {
    expect(() =>
      defineComponent({ id: "x.y", version: 2, schema: z.number(), editor: { label: "X", fields: {} } }),
    ).toThrow("no upcaster from version 1");
  });
});
