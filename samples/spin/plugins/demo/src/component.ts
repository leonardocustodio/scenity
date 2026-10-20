// SPDX-License-Identifier: Apache-2.0
/**
 * The component `demo.spin` of the demo plugin: an entity with it turns about its up axis. The editor has no
 * code for it: the inspector makes its widgets from the schema and the hints.
 */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

/** The turn speed when the value gives none, in degrees per second. */
export const DEFAULT_SPEED = 90;

export const spinSchema = z.strictObject({
  /** The turn speed in degrees per second. A negative speed turns the other way. */
  speed: z.number().min(-720).max(720).optional(),
  /** Show the hub ring of the presenter. */
  hub: z.boolean().optional(),
});
export type SpinValue = z.infer<typeof spinSchema>;

export const spinComponent = defineComponent({
  id: "demo.spin",
  schema: spinSchema,
  defaults: { speed: DEFAULT_SPEED, hub: true },
  editor: {
    label: "Spin",
    group: "Demo",
    fields: {
      // The studio face gives the widget `demo.speedDial`. With no studio face, the number field of the schema shows.
      speed: { widget: { kind: "custom", name: "demo.speedDial" }, label: "Speed" },
      hub: { widget: { kind: "boolean" }, label: "Hub ring" },
    },
  },
});
