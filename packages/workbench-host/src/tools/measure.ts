// SPDX-License-Identifier: Apache-2.0
/**
 * The measure tool of the workbench (`measure.*`). `lab_measure` gives the distance between two points or two items
 * of the visible lab. Without ends, it gives the last measurements that the owner made with the key M (two picks on
 * the scene). The lab keeps each measurement in its frame (a lab-only overlay) until the owner clears it. The context
 * packet lists them (`measureBlock`).
 *
 * The lab API calls: `measureBetween(from, to)` and `measurements()` (apps/editor `core/editor/useMeasure.ts`). The
 * host must not import the lab (tools/check-boundaries.ts), so it reads the plain data of a measurement here.
 *
 * This module has the distance part of the tool. A host plugin can replace the tool with a tool of the same name.
 * That tool adds inputs (for example the reach) and calls `measureDistance` for the distance.
 */
import { z } from "zod";
import type { ToolContext } from "./context";
import { call, defineTool, list, number, record, text, textResult, type ToolResult } from "./kit";

/** The words of one end: `prop:cart (x, y, z)`. */
function endText(value: unknown): string {
  const end = record(value);
  const at = list(end.at).map((item) => String(number(item) ?? "?"));
  return `${text(end.what) ?? "?"} (${at.join(", ")})`;
}

/** The words of one measurement: `m1: 64.0 cm (horizontal 50.0, vertical +40.0) from … to …`. */
export function measureLine(value: unknown): string {
  const item = record(value);
  const cm = (key: string): string => (number(item[key]) ?? 0).toFixed(1);
  const vertical = number(item.verticalCm) ?? 0;
  return (
    `${text(item.id) ?? "?"}: ${cm("cm")} cm (horizontal ${cm("horizontalCm")}, vertical ` +
    `${vertical > 0 ? "+" : ""}${cm("verticalCm")}) from ${endText(item.from)} to ${endText(item.to)}`
  );
}

/** The lines of the measurements of the packet: the last three, or none. A lab without measurements gives none. */
export function measureBlock(value: unknown): string[] {
  const items = list(value);
  if (items.length === 0) return [];
  const shown = items.slice(-3);
  const more = items.length > shown.length ? ` (the last ${String(shown.length)} of ${String(items.length)})` : "";
  return [`Measurements in the frame${more} (lab_measure):`, ...shown.map((item) => `  ${measureLine(item)}`)];
}

/** The inputs of the distance: two ends, or neither for the measurements of the owner. */
export const measureInput = z.object({
  from: z.string().min(1).optional().describe("The first end, for example 'prop:cart' or '0.8,1.13,-1.4'."),
  to: z.string().min(1).optional().describe("The second end, for example 'member:<id>.wrist_r'."),
});

/** The result of the distance part: the distance of two ends, or the measurements of the owner. */
export async function measureDistance(input: z.output<typeof measureInput>, ctx: ToolContext): Promise<ToolResult> {
  const port = ctx.surface("visible");
  if (input.from !== undefined && input.to !== undefined) {
    const made = await call(port, "measureBetween", [input.from, input.to]);
    return textResult([measureLine(made), "The lab shows it in the frame (Escape or measure.clear clears it)."]);
  }
  if (input.from !== undefined || input.to !== undefined) {
    return textResult("Give both ends (from and to), or neither for the measurements of the owner.");
  }
  const items = list(await call(port, "measurements"));
  if (items.length === 0) {
    return textResult("No measurements in the lab. The owner presses M and clicks two points, or give from and to.");
  }
  return textResult([`Last: ${measureLine(items.at(-1))}`, ...measureBlock(items).slice(1)]);
}

export const labMeasure = defineTool({
  name: "lab_measure",
  description:
    "Measure in the lab: the distance between two points or two items in centimetres, with its horizontal part (on " +
    "the floor) and its vertical part. An end is 'x,y,z' (metres), prop:<slot>, member:<id> (its stand place), " +
    "member:<id>.<joint> (for example member:<id>.wrist_r) or point:<work point>. Without from and to: the " +
    "measurements that the owner made with the key M (two picks). The lab shows a new measurement in the frame " +
    "until the owner clears it.",
  input: measureInput,
  alwaysLoad: false,
  handler: measureDistance,
});
