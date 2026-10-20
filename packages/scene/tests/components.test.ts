// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  builtinComponents,
  builtinRegistry,
  ComponentRegistry,
  createRegistry,
  defineComponent,
  type ComponentDefinition,
} from "../src/index";

/** A small controller: an idle and a walk state on one number parameter. */
const ANIMATOR_CONTROLLER = {
  parameters: { speed: { type: "number", default: 0 } },
  layers: [
    {
      name: "base",
      start: "idle",
      states: { idle: { motion: { kind: "clip", clip: "Idle" } }, walk: { motion: { kind: "clip", clip: "Walk" } } },
      transitions: [
        { from: "idle", to: "walk", when: [{ parameter: "speed", op: "gt", value: 0.1 }] },
        { from: "walk", to: "idle", when: [{ parameter: "speed", op: "le", value: 0.1 }] },
      ],
    },
  ],
};

/** For each built-in component: a good stored value, a bad value, and the filled value of `{}` (or the good value). */
const CASES: Record<string, { good: unknown; bad: unknown; filled: unknown }> = {
  transform: {
    good: { position: [1, 2, 3] },
    bad: { rotation: [0, 0, 0, 2] },
    filled: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  },
  model: {
    good: { asset: "asset:chair", materials: { seat: { colour: "#ff0000", roughness: 0.5 } } },
    bad: { asset: "chair.glb" },
    filled: {
      asset: "asset:chair",
      materials: { seat: { colour: "#ff0000", roughness: 0.5 } },
      castShadow: true,
      receiveShadow: true,
    },
  },
  light: {
    good: { type: "spot", angle: 0.4 },
    bad: { type: "laser" },
    filled: { type: "spot", angle: 0.4, colour: "#ffffff", intensity: 1, range: 0, penumbra: 0, shadow: false },
  },
  camera: {
    good: { fov: 45, target: "entity:bench", safeFrame: { entities: ["entity:bench"], margin: 0.1 } },
    bad: { fov: 200 },
    filled: {
      fov: 45,
      target: "entity:bench",
      safeFrame: { entities: ["entity:bench"], margin: 0.1 },
    },
  },
  environment: {
    good: { fog: { type: "exp2", colour: [10, 10, 10], density: 0.02 } },
    bad: { toneMapping: "filmic" },
    filled: {
      background: "#000000",
      toneMapping: "aces",
      exposure: 1,
      mapIntensity: 1,
      fog: { type: "exp2", colour: [10, 10, 10], density: 0.02 },
    },
  },
  socket: {
    good: { points: { top: [0, 1, 0], hand: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } } },
    bad: { points: { "bad name": [0, 0, 0] } },
    filled: { points: { top: [0, 1, 0], hand: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } } },
  },
  tags: { good: ["movable", "shop.device"], bad: ["two words"], filled: ["movable", "shop.device"] },
  visibility: { good: {}, bad: { visible: "yes" }, filled: { visible: true } },
  pickable: {
    good: { priority: 3, mode: "bounds", layers: ["props"] },
    bad: { mode: "box" },
    filled: { enabled: true, priority: 3, mode: "bounds", layers: ["props"] },
  },
  obstacle: {
    good: {
      footprint: {
        kind: "polygon",
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
      height: 1,
    },
    bad: { footprint: { kind: "polygon", points: [[0, 0]] } },
    filled: {
      footprint: {
        kind: "polygon",
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
      height: 1,
    },
  },
  standPoint: { good: { role: "lead" }, bad: { facing: "north" }, filled: { facing: 0, role: "lead" } },
  path: {
    good: {
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    },
    bad: { points: [[0, 0, 0]] },
    filled: {
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      closed: false,
      width: 0.6,
    },
  },
  annotation: { good: { text: "Note" }, bad: { text: "" }, filled: { text: "Note", colour: "#ffd166" } },
  shape: {
    good: { kind: "box", size: [4, 0.1, 3] },
    bad: { kind: "cone" },
    filled: {
      kind: "box",
      size: [4, 0.1, 3],
      colour: "#cccccc",
      roughness: 0.8,
      metalness: 0,
      castShadow: true,
      receiveShadow: true,
    },
  },
  animator: {
    good: { controller: ANIMATOR_CONTROLLER, parameters: { speed: 1 } },
    bad: { controller: { ...ANIMATOR_CONTROLLER, layers: [{ ...ANIMATOR_CONTROLLER.layers[0], start: "run" }] } },
    filled: { controller: ANIMATOR_CONTROLLER, parameters: { speed: 1 }, speed: 1, rootMotion: "in-place" },
  },
  locomotion: {
    good: { walks: [{ t: 1000, to: "entity:spot" }] },
    bad: {
      walks: [
        { t: 2000, to: "entity:spot" },
        { t: 1000, to: "entity:home" },
      ],
    },
    filled: { speed: 1, turnSpeed: 4, parameter: "speed", walks: [{ t: 1000, to: "entity:spot" }] },
  },
  audioSource: {
    good: { asset: "asset:01J9Z6Q3RB", volume: 0.5, spatial: false },
    bad: { volume: -1 },
    filled: {
      asset: "asset:01J9Z6Q3RB",
      volume: 0.5,
      loop: false,
      spatial: false,
      refDistance: 1,
      rolloff: 1,
      maxDistance: 10000,
      distanceModel: "inverse",
      autoplay: false,
    },
  },
  character: {
    good: {
      rig: "rigify",
      variants: { night: { Body: { colour: "#223344" } } },
      variant: "night",
      ik: { rightHand: { target: "entity:cup", weight: 0.5 }, look: { target: "entity:cup#rim" } },
    },
    bad: { variant: "day", variants: { night: {} } },
    filled: {
      rig: "rigify",
      variants: { night: { Body: { colour: "#223344" } } },
      variant: "night",
      ik: { rightHand: { target: "entity:cup", weight: 0.5 }, look: { target: "entity:cup#rim" } },
    },
  },
  prefab: {
    good: { source: "props/door.prefab.json", overrides: [{ op: "remove", id: "leaf" }] },
    bad: { source: "door.glb" },
    filled: { source: "props/door.prefab.json", overrides: [{ op: "remove", id: "leaf" }] },
  },
};

/** The keys of the stored object of a schema, when the schema is an object. */
function schemaKeys(definition: ComponentDefinition): string[] {
  const schema = definition.schema as unknown as { shape?: Record<string, unknown> };
  return schema.shape === undefined ? [definition.id] : Object.keys(schema.shape);
}

describe("the built-in components", () => {
  const registry = builtinRegistry();

  test("the set is the list of the test cases", () => {
    expect(builtinComponents.map((item) => item.id).sort()).toEqual(Object.keys(CASES).sort());
  });

  test.each(builtinComponents.map((item) => [item.id, item] as const))(
    "%s: schema, defaults and editor hints",
    (id, definition) => {
      const sample = CASES[id]!;
      expect(registry.check(id, sample.good).ok).toBe(true);
      const bad = registry.check(id, sample.bad, `/entities/e/components/${id}`);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.errors[0]?.path.startsWith(`/entities/e/components/${id}`)).toBe(true);
      expect(registry.fill(id, sample.good)).toEqual(sample.filled);
      expect(definition.editor.label.length).toBeGreaterThan(0);
      expect(Object.keys(definition.editor.fields).sort()).toEqual(schemaKeys(definition).sort());
      // Each default is a valid stored value.
      expect(definition.schema.safeParse(mergeIfObject(definition.defaults, sample.good)).success).toBe(true);
    },
  );

  test("the sites: tags is an entity field and environment a scene field", () => {
    expect(registry.atSite("entity").map((item) => item.id)).toEqual(["tags"]);
    expect(registry.atSite("scene").map((item) => item.id)).toEqual(["environment"]);
  });

  test("the transform quaternion is shown as Euler degrees; vectors and numbers carry units", () => {
    const fields = registry.get("transform")!.editor.fields;
    expect(fields.rotation?.widget).toEqual({ kind: "quaternion" });
    expect(fields.position?.widget).toMatchObject({ kind: "vector3", unit: "m" });
    expect(registry.get("model")!.editor.fields.asset?.widget).toEqual({ kind: "assetRef", assetKind: "model" });
    expect(registry.get("light")!.editor.fields.type?.widget).toMatchObject({ kind: "enum" });
    expect(registry.get("camera")!.editor.fields.fov?.widget).toMatchObject({
      kind: "number",
      unit: "deg",
      min: 1,
      max: 179,
    });
  });
});

function mergeIfObject(defaults: unknown, good: unknown): unknown {
  return typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)
    ? { ...defaults, ...(good as object) }
    : good;
}

describe("the component registry", () => {
  const plugin = defineComponent({
    id: "doors.door",
    schema: z.strictObject({ open: z.boolean().optional() }),
    defaults: { open: false },
    editor: { label: "Door", group: "Doors", fields: { open: { widget: { kind: "boolean" }, label: "Open" } } },
  });

  test("each registry is its own instance: a plugin registers into one registry only", () => {
    const a = createRegistry(builtinComponents).register(plugin);
    const b = createRegistry(builtinComponents);
    expect(a.has("doors.door")).toBe(true);
    expect(b.has("doors.door")).toBe(false);
    expect(a).toBeInstanceOf(ComponentRegistry);
    expect(a.fill("doors.door", {})).toEqual({ open: false });
  });

  test("a second definition with the same ID is an error", () => {
    expect(() => createRegistry(builtinComponents).register(builtinComponents[0]!)).toThrow("registered already");
  });

  test("an unknown component is kept as opaque data with a warning", () => {
    const result = createRegistry().check("doors.door", { open: "maybe" }, "/x");
    expect(result).toEqual({
      ok: true,
      value: { open: "maybe" },
      warnings: [{ path: "/x", message: 'unknown component "doors.door": the value stays as it is' }],
    });
    expect(createRegistry().fill("doors.door", { a: 1 })).toEqual({ a: 1 });
  });

  test("defineComponent refuses a bad ID", () => {
    expect(() => defineComponent({ id: "Doors door", schema: z.number(), editor: { label: "X", fields: {} } })).toThrow(
      "not a component ID",
    );
  });
});
