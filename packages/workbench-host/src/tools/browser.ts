// SPDX-License-Identifier: Apache-2.0
/**
 * The content browser tools of the workbench: `lab_open` opens an item and plays its scene, and `lab_browse` lists a
 * folder of the browser tree. The lab API has `open`, `item` and `browse`.
 * The catalog search is a tool of a host plugin (plugin.ts).
 */
import { z } from "zod";
import { whereInput } from "./frame";
import { call, cut, defineTool, frameUrl, list, number, portOf, record, shownUrl, text, textResult } from "./kit";

/** The scene of an item (the `ItemScene` of the editor plugin) in one line. */
export function sceneLine(value: unknown): string {
  if (value === null || value === undefined) return "no scene (the lab cannot show it yet)";
  const scene = record(value);
  const window = record(scene.window);
  const camera = text(scene.camera) ?? (scene.camera === undefined ? "?" : "a free view");
  const parts = [
    `take ${text(scene.take) ?? "?"}`,
    `window ${String(number(window.from) ?? "?")}–${String(number(window.to) ?? "?")} ms`,
    `moment ${String(number(scene.moment) ?? "?")} ms`,
    `camera ${camera}`,
    `cast ${text(scene.cast) ?? "none"}`,
    scene.exact === false ? "the family of the clip (not exact)" : "exact",
  ];
  return parts.join(" · ");
}

export const labOpen = defineTool({
  name: "lab_open",
  description:
    "Open an item of the content browser of the lab by its key (lab_browse gives keys, for example " +
    "'take:<name>' for a take): its scene loads and, with play, plays. Gives the item, its scene (take, window, " +
    "moment, camera, cast) and the URL.",
  input: z.object({
    key: z.string().min(1).describe("The key of the item (lab_browse gives keys)."),
    play: z.boolean().optional().describe("Play the scene (default: the browser default)."),
    where: whereInput,
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = portOf(ctx, input.where);
    const options = input.play === undefined ? {} : { play: input.play };
    const opened = await call(port, "open", [input.key, options]);
    if (opened === false) throw new Error(`open: the item "${input.key}" has no scene in the lab.`);
    const item = record(await call(port, "item"));
    const url = shownUrl(await frameUrl(port));
    return textResult([
      `Opened ${text(item.key) ?? input.key}: ${text(item.title) ?? ""}`,
      `Scene: ${sceneLine(item.scene)}`,
      `URL: ${url}`,
    ]);
  },
});

export const labBrowse = defineTool({
  name: "lab_browse",
  description:
    "List the children of a folder of the content browser of the lab (a path of keys joined with '/', or '' for " +
    "the top). Each child has its key, its title, its kind and whether the lab has a scene for it.",
  input: z.object({
    path: z.string().describe("The folder: keys joined with '/', or '' for the top of the tree."),
    where: whereInput,
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = portOf(ctx, input.where);
    const children = list(await call(port, "browse", [input.path])).map(record);
    const line = (item: Record<string, unknown>): string =>
      `  ${text(item.key) ?? "?"} · ${text(item.title) ?? ""} · ${text(item.kind) ?? "?"}${item.scene === true ? "" : " · no scene"}`;
    return textResult([
      `Folder "${input.path}": ${String(children.length)} items.`,
      ...cut(children, 40, line, "browse a sub folder"),
    ]);
  },
});
