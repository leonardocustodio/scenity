// SPDX-License-Identifier: Apache-2.0
/**
 * The fixtures of the inspector tests: a component of a test plugin with a zod schema and few editor hints, a registry
 * with it, and a garden scene with a prefab instance (a chair with an override of its seat colour).
 */
import { z } from "zod";
import { builtinRegistry, readDocument } from "@scenity/scene";
import { defineComponent } from "@scenity/scene/components";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { InspectorSource } from "../src/index";
import { garden } from "./helpers";

/** The component of the test plugin: each kind of widget, and labels for two fields only. */
export const beaconComponent = defineComponent({
  id: "fixture.beacon",
  schema: z.strictObject({
    rate: z.number().min(0).max(10),
    tint: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.tuple([z.number(), z.number(), z.number()])]).optional(),
    mode: z.enum(["steady", "blink", "pulse"]),
    on: z.boolean().optional(),
    label: z.string().optional(),
    offset: z.tuple([z.number(), z.number()]).optional(),
    target: z
      .string()
      .regex(/^entity:[A-Za-z0-9_-]{1,64}(#[A-Za-z0-9_.:-]{1,64})?$/)
      .optional(),
    sound: z
      .string()
      .regex(/^asset:[A-Za-z0-9_.-]{1,128}$/)
      .optional(),
    glow: z.array(z.strictObject({ t: z.number().min(0), value: z.number() })).optional(),
    halo: z.strictObject({ radius: z.number().min(0), soft: z.boolean().optional() }).optional(),
    count: z.number().int().min(1).max(8).optional(),
  }),
  defaults: { tint: "#ffcc00", on: true, offset: [0, 0] },
  editor: {
    label: "Beacon",
    group: "Fixture",
    fields: {
      rate: { widget: { kind: "number", unit: "Hz", step: 0.1 }, label: "Blink rate" },
      halo: { widget: { kind: "custom", name: "haloEditor" }, label: "Halo" },
    },
  },
});

export const fixtureRegistry = builtinRegistry().register(beaconComponent);

/** The chair prefab: a root and a seat with a colour. */
export const chairPrefab: PrefabDocument = {
  format: "scenity.prefab/1",
  id: "chair",
  root: "base",
  entities: {
    base: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
    seat: {
      name: "Seat",
      parent: "base",
      index: 0,
      components: {
        transform: { position: [0, 0.45, 0] },
        shape: { kind: "box", size: [0.5, 0.05, 0.5], colour: "#888888" },
      },
    },
  },
};

/** The garden scene with a chair instance whose seat is red. */
export function gardenWithChair(): SceneDocument {
  const doc = garden();
  const text = JSON.stringify({
    ...doc,
    entities: {
      ...doc.entities,
      chair: {
        parent: null,
        index: 3,
        components: {
          transform: { position: [2, 0, 1] },
          prefab: {
            source: "chair.prefab.json",
            overrides: [{ op: "set", path: "/entities/seat/components/shape/colour", value: "#ff0000" }],
          },
        },
      },
    },
  });
  const read = readDocument(text, "scene", { registry: fixtureRegistry });
  if (!read.ok) throw new Error(read.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  return read.doc;
}

/** An inspector source over a document with the chair prefab. */
export function sourceOf(doc: SceneDocument): InspectorSource {
  return {
    doc,
    registry: fixtureRegistry,
    prefab: (source) => (source === "chair.prefab.json" ? chairPrefab : undefined),
  };
}
