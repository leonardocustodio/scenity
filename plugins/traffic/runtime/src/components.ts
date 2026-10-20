// SPDX-License-Identifier: Apache-2.0
/**
 * The components of the traffic plugin. The editor has no code for them: the
 * inspector makes its widgets from the schemas and the hints.
 *
 * - `traffic.signal`: one lamp state of a signal head. The road system shows the entity when the phase lights `lamp`
 *   (`lit: true`), or when it does not (`lit: false`). So a lamp has two entities: the lit lamp and the dark lamp.
 * - `traffic.vehicle` and `traffic.pedestrian`: an entity that the simulation moves. The system hides it while the
 *   simulation has no car or walker with its ID.
 * - `traffic.button`: the push button of the crossing. A click on it in the play mode presses the button (input.ts).
 */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

export const SIGNAL_HEADS = ["car", "walk"] as const;
export const SIGNAL_LAMPS = ["red", "amber", "green", "walk", "wait"] as const;

export const signalSchema = z.strictObject({
  /** The head of the signal: `car` (red, amber, green) or `walk` (walk, wait). */
  head: z.enum(SIGNAL_HEADS),
  lamp: z.enum(SIGNAL_LAMPS),
  /** True for the lit lamp, false for the dark lamp. */
  lit: z.boolean().optional(),
});
export type SignalValue = z.infer<typeof signalSchema>;

export const signalComponent = defineComponent({
  id: "traffic.signal",
  schema: signalSchema,
  defaults: { lit: true },
  editor: {
    label: "Signal lamp",
    group: "Traffic",
    fields: {
      head: { widget: { kind: "enum", options: SIGNAL_HEADS }, label: "Head" },
      lamp: { widget: { kind: "enum", options: SIGNAL_LAMPS }, label: "Lamp" },
      lit: { widget: { kind: "boolean" }, label: "Lit" },
    },
  },
});

export const vehicleComponent = defineComponent({
  id: "traffic.vehicle",
  schema: z.strictObject({}),
  defaults: {},
  editor: { label: "Vehicle", group: "Traffic", fields: {} },
});

export const pedestrianComponent = defineComponent({
  id: "traffic.pedestrian",
  schema: z.strictObject({}),
  defaults: {},
  editor: { label: "Pedestrian", group: "Traffic", fields: {} },
});

export const buttonComponent = defineComponent({
  id: "traffic.button",
  schema: z.strictObject({}),
  defaults: {},
  editor: { label: "Crossing button", group: "Traffic", fields: {} },
});

export const trafficComponents = [signalComponent, vehicleComponent, pedestrianComponent, buttonComponent];
