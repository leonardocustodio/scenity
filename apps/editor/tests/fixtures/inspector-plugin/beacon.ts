// SPDX-License-Identifier: Apache-2.0
/**
 * The component of the test plugin of the inspector: a zod schema with each kind of value, and editor hints
 * for one field only. The editor has no code for it: the inspector makes its widgets from the schema.
 */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

const colour = z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.tuple([z.number(), z.number(), z.number()])]);

export const beaconComponent = defineComponent({
  id: "fixture.beacon",
  schema: z.strictObject({
    rate: z.number().min(0).max(10),
    tint: colour.optional(),
    mode: z.enum(["steady", "blink", "pulse"]),
    on: z.boolean().optional(),
    label: z.string().optional(),
    offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
    target: z
      .string()
      .regex(/^entity:[A-Za-z0-9_-]{1,64}(#[A-Za-z0-9_.:-]{1,64})?$/)
      .optional(),
    sound: z
      .string()
      .regex(/^asset:[A-Za-z0-9_.-]{1,128}$/)
      .optional(),
    glow: z.array(z.strictObject({ t: z.number().min(0), value: z.number() })).optional(),
  }),
  defaults: { tint: "#ffcc00", on: true },
  editor: {
    label: "Beacon",
    group: "Fixture",
    fields: { rate: { widget: { kind: "number", unit: "Hz", step: 0.1 }, label: "Blink rate" } },
  },
});
