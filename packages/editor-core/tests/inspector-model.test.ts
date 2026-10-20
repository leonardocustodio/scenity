// SPDX-License-Identifier: Apache-2.0 The inspector model: the widgets from the component schemas and hints, the shared
// components, the field states with mixed values and prefab overrides, and the value helpers of the widgets.
import { describe, expect, test } from "bun:test";
import { builtinRegistry } from "@scenity/scene";
import {
  addableComponents,
  addCurveItem,
  assetChoices,
  colourHex,
  colourValue,
  componentModel,
  curvePoints,
  curvePolyline,
  dragNumber,
  entityChoices,
  eulerDegrees,
  fieldState,
  initialComponent,
  mixedParts,
  parseNumber,
  prefabEntities,
  quaternionOf,
  SCENE_SUBJECT,
  sharedComponents,
  sortKeys,
  subjectOf,
  subjectsOf,
  type FieldModel,
  type WidgetModel,
} from "../src/index";
import { beaconComponent, fixtureRegistry, gardenWithChair, sourceOf } from "./inspectorFixture";

const builtins = builtinRegistry();

function widgetOf(component: string, key: string): WidgetModel | undefined {
  const definition = fixtureRegistry.get(component);
  if (definition === undefined) throw new Error(`no component ${component}`);
  return componentModel(definition).fields.find((field: FieldModel) => field.key === key)?.widget;
}

describe("the widgets of the built-in components", () => {
  test("a transform has vectors and a quaternion", () => {
    expect(widgetOf("transform", "position")).toMatchObject({ kind: "vector", size: 3, unit: "m" });
    expect(widgetOf("transform", "rotation")).toEqual({ kind: "quaternion" });
  });

  test("a light has an enum, a colour, numbers with limits, a point-or-entity choice and a nested object", () => {
    expect(widgetOf("light", "type")).toEqual({
      kind: "enum",
      options: ["directional", "point", "spot", "ambient", "hemisphere"],
    });
    expect(widgetOf("light", "colour")).toEqual({ kind: "colour" });
    expect(widgetOf("light", "penumbra")).toMatchObject({ kind: "number", min: 0, max: 1, step: 0.01 });
    const target = widgetOf("light", "target");
    expect(target?.kind).toBe("choice");
    if (target?.kind === "choice") expect(target.options.map((option) => option.kind)).toEqual(["vector", "entityRef"]);
    const camera = widgetOf("light", "shadowCamera");
    expect(camera?.kind).toBe("object");
    if (camera?.kind === "object") expect(camera.fields.map((field) => field.key)).toContain("far");
  });

  test("a model has an asset reference of its kind and a map of material overrides", () => {
    expect(widgetOf("model", "asset")).toEqual({ kind: "assetRef", assetKind: "model" });
    const materials = widgetOf("model", "materials");
    expect(materials?.kind).toBe("map");
    if (materials?.kind === "map") expect(materials.item.kind).toBe("object");
  });

  test("the points of a path are a curve of points; the walks of a locomotion are a list of objects", () => {
    expect(widgetOf("path", "points")).toEqual({ kind: "curve", form: "points", size: 3 });
    const walks = widgetOf("locomotion", "walks");
    expect(walks?.kind).toBe("list");
    if (walks?.kind === "list") expect(walks.item.kind).toBe("object");
  });

  test("each built-in component gets a model with no JSON field at the top", () => {
    for (const definition of builtins.list()) {
      const model = componentModel(definition);
      expect(model.fields.length, definition.id).toBeGreaterThan(0);
    }
  });
});

describe("a component of a plugin with no editor code", () => {
  test("the schema gives the widget of each field that the hints do not name", () => {
    const model = componentModel(beaconComponent);
    expect(model.label).toBe("Beacon");
    expect(model.fields.map((field) => field.key)).toEqual([
      "rate",
      "halo",
      "tint",
      "mode",
      "on",
      "label",
      "offset",
      "target",
      "sound",
      "glow",
      "count",
    ]);
    const field = (key: string) => model.fields.find((item) => item.key === key);
    expect(field("rate")).toMatchObject({ label: "Blink rate", required: true });
    expect(field("rate")?.widget).toMatchObject({ kind: "number", min: 0, max: 10, step: 0.1, unit: "Hz" });
    expect(field("tint")?.widget).toEqual({ kind: "colour" });
    expect(field("mode")?.widget).toEqual({ kind: "enum", options: ["steady", "blink", "pulse"] });
    expect(field("on")?.widget).toEqual({ kind: "boolean" });
    expect(field("label")?.widget).toEqual({ kind: "string", multiline: false });
    expect(field("offset")?.widget).toMatchObject({ kind: "vector", size: 2 });
    expect(field("target")?.widget).toEqual({ kind: "entityRef" });
    expect(field("sound")?.widget).toEqual({ kind: "assetRef" });
    expect(field("glow")?.widget).toEqual({ kind: "curve", form: "keys", time: "t", value: "value" });
    expect(field("count")?.widget).toMatchObject({ kind: "number", integer: true, step: 1, min: 1, max: 8 });
    // A custom hint with no widget in the editor: the schema gives an object widget with the label of the hint.
    expect(field("halo")).toMatchObject({ label: "Halo", required: false });
    expect(field("halo")?.widget.kind).toBe("object");
    expect(field("glow")?.label).toBe("Glow");
  });

  test("a new beacon gets its required fields; the registry accepts the value", () => {
    const value = initialComponent(beaconComponent);
    expect(value).toEqual({ rate: 0, mode: "steady" });
    expect(fixtureRegistry.check("fixture.beacon", value).ok).toBe(true);
    const model = initialComponent(fixtureRegistry.get("model") ?? beaconComponent, {
      assets: [{ id: "chair01", kind: "model", label: "chair.glb" }],
      entities: [],
    });
    expect(model).toEqual({ asset: "asset:chair01" });
  });
});

describe("the field states", () => {
  const source = sourceOf(gardenWithChair());

  test("two entities share the components that both hold; a mixed value shows as mixed", () => {
    const subjects = subjectsOf(source, ["table", "bench"]);
    expect(sharedComponents(source, subjects).map((definition) => definition.id)).toEqual([
      "transform",
      "shape",
      "socket",
      "tags",
    ]);
    const shape = fixtureRegistry.get("shape");
    if (shape === undefined) throw new Error("no shape");
    const colour = fieldState(source, subjects, shape, "colour");
    expect(colour.mixed).toBe(true);
    expect(colour.values).toEqual(["#c8b89a", "#8a6a4a"]);
    const transform = fixtureRegistry.get("transform");
    if (transform === undefined) throw new Error("no transform");
    const position = fieldState(source, subjects, transform, "position");
    expect(mixedParts(position.values, 3)).toEqual([true, false, true]);
    // A default fills a value that the document does not store.
    const scale = fieldState(source, subjects, transform, "scale");
    expect(scale).toMatchObject({ value: [1, 1, 1], mixed: false, stored: false, defaultValue: [1, 1, 1] });
  });

  test("the add menu offers the components that not each subject holds, plugin components too", () => {
    const ids = addableComponents(source, subjectsOf(source, ["table"])).map((definition) => definition.id);
    expect(ids).toContain("fixture.beacon");
    expect(ids).toContain("light");
    expect(ids).not.toContain("shape");
    expect(ids).not.toContain("environment");
    expect(addableComponents(source, [SCENE_SUBJECT])).toEqual([]);
  });

  test("the scene subject shows the scene-level components", () => {
    const ids = sharedComponents(source, [SCENE_SUBJECT]).map((definition) => definition.id);
    expect(ids).toEqual(["environment"]);
  });

  test("a prefab entity shows its overrides and the prefab value", () => {
    expect(prefabEntities(source, "chair")).toEqual([
      { id: "chair/base", label: "base", overrides: 0 },
      { id: "chair/seat", label: "Seat", overrides: 1 },
    ]);
    const seat = subjectOf(source, "chair/seat");
    expect(seat?.kind).toBe("prefab");
    const shape = fixtureRegistry.get("shape");
    if (seat === null || shape === undefined) throw new Error("no seat");
    const colour = fieldState(source, [seat], shape, "colour");
    expect(colour).toMatchObject({ value: "#ff0000", overridden: true, prefabValue: "#888888" });
    expect(fieldState(source, [seat], shape, "size")).toMatchObject({ overridden: false, value: [0.5, 0.05, 0.5] });
    expect(subjectOf(source, "chair/none")).toBeNull();
    expect(subjectOf({ ...source, prefab: () => undefined }, "chair/seat")).toBeNull();
  });
});

describe("the value helpers of the widgets", () => {
  test("numbers keep their limits; a drag moves in steps", () => {
    expect(parseNumber("12", { min: 0, max: 10 })).toBe(10);
    expect(parseNumber("2,5", { integer: true })).toBe(3);
    expect(parseNumber("x", {})).toBeNull();
    expect(dragNumber(1, 40, { step: 0.1 })).toBe(2);
    expect(dragNumber(1, 40, { step: 0.1 }, { shift: true })).toBe(11);
    expect(dragNumber(1, -400, { step: 0.1, min: 0 })).toBe(0);
  });

  test("a colour keeps its form; a quaternion round trips through Euler degrees", () => {
    expect(colourHex([255, 0, 16])).toBe("#ff0010");
    expect(colourHex("#ABCDEF")).toBe("#abcdef");
    expect(colourValue("#ff0010", [1, 2, 3])).toEqual([255, 0, 16]);
    expect(colourValue("#FF0010", "#000000")).toBe("#ff0010");
    const q = quaternionOf([0, 90, 0]);
    expect(eulerDegrees(q)).toEqual([0, 90, 0]);
    expect(eulerDegrees(undefined)).toEqual([0, 0, 0]);
  });

  test("a curve gives points, a line, a new key and keys in time order", () => {
    const keys = { kind: "curve", form: "keys", time: "t", value: "value" } as const;
    const value = [
      { t: 0, value: 1 },
      { t: 500, value: 3 },
    ];
    expect(curvePoints(keys, value)).toEqual([
      [0, 1],
      [500, 3],
    ]);
    expect(curvePolyline(curvePoints(keys, value), 100, 40)).toBe("4,36 96,4");
    expect(addCurveItem(keys, value).at(-1)).toEqual({ t: 1500, value: 3 });
    expect(sortKeys(keys, [{ t: 9 }, { t: 1 }])).toEqual([{ t: 1 }, { t: 9 }]);
    const points = { kind: "curve", form: "points", size: 3 } as const;
    expect(curvePoints(points, [[1, 2, 3]])).toEqual([[1, 3]]);
    expect(addCurveItem(points, [[1, 2, 3]]).at(-1)).toEqual([2, 2, 3]);
  });

  test("the pickers list the assets of the manifest and the entities with their sockets", () => {
    const assets = assetChoices([
      { id: "b", kind: "model", files: [{ file: "assets/sources/zebra.glb" }] },
      { id: "a", kind: "texture" },
    ]);
    expect(assets).toEqual([
      { id: "a", kind: "texture", label: "a" },
      { id: "b", kind: "model", label: "zebra.glb" },
    ]);
    const entities = entityChoices(gardenWithChair());
    expect(entities.find((entity) => entity.id === "bench")).toEqual({
      id: "bench",
      label: "Bench",
      subs: ["left", "right"],
    });
  });
});
