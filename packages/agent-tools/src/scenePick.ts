// SPDX-License-Identifier: Apache-2.0
/**
 * The tools `scene_pick` and `scene_sheet` of the scene page. In the lab, `lab_pick` and `lab_sheet` are the tools of
 * the room, because the lab page serves no `scene.pick`.
 *
 * - `scene_pick`: the entity under a point of the canvas (CSS pixels). When the input asks for it, the tool also gives
 *   the nearest sub-target: a socket, a bone or a path point, with the reference `entity:<id>#<sub>`. Without a point,
 *   it gives the entities that the owner selected. The tool adds the place of each entity from `scene.query`.
 * - `scene_sheet`: one contact sheet of the open scene, from the camera preview of the page. It has a cell for each
 *   time (a scene with a sequence) and each document camera. After the sheet, the clock of the page returns to its
 *   time.
 */
import { SCENE_PICK_CALL, SCENE_QUERY_CALL } from "@scenity/bridge";
import { z } from "zod";
import { isCaptureMime } from "./capture";
import type { SurfacePort } from "./context";
import {
  call,
  callTyped,
  defineTool,
  fmt,
  FRAME_TIMEOUT_MS,
  imageContent,
  list,
  pictureBytes,
  record,
  text,
} from "./kit";
import { entityLines } from "./query";

/** The lines of the entities of a list of IDs (from `scene.query`). */
async function placeLines(port: SurfacePort, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const answer = await callTyped(port, SCENE_QUERY_CALL, [{ ids: [...ids] }]);
  return answer.entities.flatMap(entityLines);
}

export const scenePick = defineTool({
  name: "scene_pick",
  description:
    "What is under a point of the scene page (x and y in CSS pixels of its canvas): the entity, the component, the " +
    "world point and the distance; with `sub` also the nearest socket, bone or path point (entity:<id>#<sub>). " +
    "Without a point: the entities that the owner selected.",
  input: z.object({
    x: z.number().optional().describe("The x of the point in CSS pixels of the canvas."),
    y: z.number().optional().describe("The y of the point in CSS pixels of the canvas."),
    sub: z
      .union([z.boolean(), z.array(z.enum(["socket", "bone", "pathPoint"]))])
      .optional()
      .describe("true: name the nearest sub-target of each kind; a list: of these kinds (default: none)."),
    layers: z.array(z.string().min(1)).optional().describe("Hit only the entities with one of these pick layers."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    if (input.x === undefined || input.y === undefined) {
      if (input.x !== undefined || input.y !== undefined) throw new Error("Give both x and y, or neither.");
      const selected = list(await call(port, "selection")).flatMap((id) => (typeof id === "string" ? [id] : []));
      const head = selected.length === 0 ? "The owner selected nothing." : `Selected: ${selected.join(", ")}.`;
      return { content: [{ type: "text", text: [head, ...(await placeLines(port, selected))].join("\n") }] };
    }
    const options = {
      ...(input.sub === undefined ? {} : { sub: input.sub }),
      ...(input.layers === undefined ? {} : { layers: input.layers }),
    };
    const hit = await callTyped(port, SCENE_PICK_CALL, [input.x, input.y, options]);
    if (hit === null) return { content: [{ type: "text", text: "Nothing under the point." }] };
    const ref = `entity:${hit.entity}${hit.sub === undefined ? "" : `#${hit.sub}`}`;
    const point = hit.point.map((value) => fmt(value)).join(", ");
    const lines = [
      `Hit ${ref}${hit.component === null ? "" : ` (component ${hit.component})`} at [${point}], ` +
        `${fmt(hit.distance)} m from the camera.`,
      ...(await placeLines(port, [hit.entity])),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
});

export const sceneSheet = defineTool({
  name: "scene_sheet",
  description:
    "One contact sheet of the scene page: a cell per time (ms; a scene with a sequence) and per document camera, " +
    "with the time and the camera under each cell. The clock of the page goes back after the sheet. Use it, not many " +
    "scene_frame calls.",
  input: z.object({
    times: z.array(z.number().min(0)).max(64).optional().describe("The times in ms (default: the time now)."),
    cameras: z.array(z.string().min(1)).max(8).optional().describe("The document cameras (default: the page camera)."),
    width: z.number().int().min(320).max(1600).optional().describe("The width of the sheet in pixels (default 1280)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    const args = {
      ...(input.times === undefined ? {} : { times: input.times }),
      ...(input.cameras === undefined ? {} : { cameras: input.cameras }),
      maxWidth: input.width ?? 1280,
    };
    const sheet = record(await call(port, "sheet", [args], FRAME_TIMEOUT_MS * 4));
    const bytes = pictureBytes(sheet);
    const mime = isCaptureMime(sheet.mime) ? sheet.mime : "image/webp";
    if (bytes === null) throw new Error("sheet: the scene page gave no picture.");
    const cameras = list(sheet.cameras).map(text).join(", ");
    const times = list(sheet.simMs).filter((value) => typeof value === "number");
    const when = times.length === 0 ? "now" : `${String(new Set(times).size)} times`;
    const head = `Sheet of the open scene · ${String(list(sheet.simMs).length)} cells · ${when} · cameras ${cameras}`;
    const size = `Picture: ${String(sheet.width)}×${String(sheet.height)} ${mime}.`;
    return { content: [{ type: "text", text: `${head}\n${size}` }, imageContent({ bytes, mime })] };
  },
});
