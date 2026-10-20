// SPDX-License-Identifier: Apache-2.0
/**
 * The component `probe.drop` of the probe plugin: its entity goes to the point where a downward ray from the
 * source entity hits a collider. The entity hides when the ray hits nothing.
 */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

export const dropSchema = z.strictObject({
  /** The entity ID of the source of the ray. */
  source: z.string().min(1),
  /** The height of the entity over the hit point, in metres. */
  lift: z.number().min(0).max(1).optional(),
});
export type DropValue = z.infer<typeof dropSchema>;

/** The lift when the value gives none, in metres. */
export const DEFAULT_LIFT = 0.005;

export const dropComponent = defineComponent({
  id: "probe.drop",
  schema: dropSchema,
  defaults: { lift: DEFAULT_LIFT },
  editor: {
    label: "Drop marker",
    group: "Probe",
    fields: {
      source: { widget: { kind: "entityRef" }, label: "Source" },
      lift: { widget: { kind: "number", unit: "m", min: 0, max: 1, step: 0.001 }, label: "Lift" },
    },
  },
});
