// SPDX-License-Identifier: Apache-2.0
/**
 * The generic view tools of the open scene, for the scene page of a project and the lab:
 *
 * - `scene_frame`: one picture of the open scene at a time (a page with a sequence or a take) and from a document
 *   camera. On the scene page, the picture comes from the shadow frame of the page (`shadow.frame`), so the view of the
 *   person does not move. The lab changes its visible frame to that time and camera.
 * - `scene_measure`: the distance of two ends: an entity ID (its world origin) or a world point `x,y,z`. With two
 *   entities that have world bounds, the tool also gives the gap between their boxes. It reads the ends with the call
 *   `scene.query`, so no page code measures.
 */
import { SCENE_QUERY_CALL, SHADOW_FRAME_CALL, type SceneQueryEntity } from "@scenity/bridge";
import { z } from "zod";
import { call, captureOf, defineTool, FRAME_TIMEOUT_MS, fmt, imageContent, textResult } from "./kit";
import type { SurfacePort } from "./context";

export const sceneFrame = defineTool({
  name: "scene_frame",
  description:
    "One picture of the open scene of the editor window: optional a time `t` in ms (a scene with a sequence) and a " +
    "document camera. The picture comes from a shadow view: the " +
    "camera, the time and the selection of the person stay as they are.",
  input: z.object({
    t: z.number().min(0).optional().describe("The time in ms (the page clock stops there)."),
    camera: z.string().min(1).optional().describe("A document camera of the scene, for example 'front'."),
    width: z.number().int().min(160).max(1280).optional().describe("The width of the picture in pixels (default 960)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    const picture = captureOf(await shadowOrVisible(port, input));
    const at = picture.simMs === null ? "" : ` at ${String(picture.simMs)} ms`;
    const head = `Frame${at}${input.camera === undefined ? "" : ` from ${input.camera}`}`;
    return {
      content: [
        { type: "text", text: `${head} (${String(picture.width)} × ${String(picture.height)})` },
        imageContent(picture),
      ],
    };
  },
});

/**
 * The picture of `scene_frame`: the shadow frame of a page that has one, so the view of the person does not change.
 * Else (the lab), the visible frame at the time and the camera.
 */
async function shadowOrVisible(
  port: SurfacePort,
  input: { readonly t?: number | undefined; readonly camera?: string | undefined; readonly width?: number | undefined },
): Promise<unknown> {
  const request = {
    ...(input.t === undefined ? {} : { t: input.t }),
    ...(input.camera === undefined ? {} : { camera: input.camera }),
    width: input.width ?? 960,
  };
  try {
    return await call(port, SHADOW_FRAME_CALL.name, [request], FRAME_TIMEOUT_MS);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(`No call "${SHADOW_FRAME_CALL.name}"`)) throw error;
  }
  if (input.t !== undefined) {
    await call(port, "pause");
    await call(port, "seek", [input.t], FRAME_TIMEOUT_MS);
  }
  if (input.camera !== undefined) await call(port, "camera", [input.camera], FRAME_TIMEOUT_MS);
  await call(port, "frame", [], FRAME_TIMEOUT_MS);
  return call(port, "capture", [request.width], FRAME_TIMEOUT_MS);
}

type Vec = readonly [number, number, number];

/** One end of a measure: a world point, the entity ID, and the world box of the entity (or null). */
interface End {
  readonly name: string;
  readonly point: Vec;
  readonly box: { readonly min: readonly number[]; readonly max: readonly number[] } | null;
}

/** A point `x,y,z`, or null for an entity ID. */
function pointOf(text: string): Vec | null {
  const parts = text.split(",").map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every((value) => Number.isFinite(value)) ? (parts as unknown as Vec) : null;
}

/** The ends of a measure: points stay; entity IDs come from `scene.query`. */
async function endsOf(port: SurfacePort, given: readonly string[]): Promise<End[]> {
  const ids = given.filter((item) => pointOf(item) === null);
  const answer = ids.length === 0 ? null : await call(port, SCENE_QUERY_CALL.name, [{ ids }]);
  const entities = answer === null ? [] : SCENE_QUERY_CALL.result(answer).entities;
  return given.map((item) => {
    const point = pointOf(item);
    if (point !== null) return { name: item, point, box: null };
    const entity: SceneQueryEntity | undefined = entities.find((found) => found.id === item);
    const at = entity?.world?.position;
    if (entity === undefined || at === undefined) throw new Error(`The entity "${item}" has no world place.`);
    return { name: item, point: [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0], box: entity.bounds };
  });
}

/** The gap between two boxes on each axis (0 where they overlap) and its length. */
function boxGap(a: NonNullable<End["box"]>, b: NonNullable<End["box"]>): { gap: number[]; length: number } {
  const gap = [0, 1, 2].map((axis) => {
    const low = Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0);
    const high = Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0);
    return Math.max(0, low - high);
  });
  return { gap, length: Math.hypot(...gap) };
}

export const sceneMeasure = defineTool({
  name: "scene_measure",
  description:
    "Measure in the open scene: the distance of two ends, each an entity ID (its world origin) or a world point " +
    "'x,y,z' in metres. Gives the distance and its x, y and z parts; for two entities with world bounds also the " +
    "gap between their boxes (0 when they touch or overlap).",
  input: z.object({
    from: z.string().min(1).describe("The first end: an entity ID, or a world point such as '0.5,0,-1'."),
    to: z.string().min(1).describe("The second end: an entity ID, or a world point."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const [a, b] = await endsOf(ctx.surface("visible"), [input.from, input.to]);
    if (a === undefined || b === undefined) throw new Error("Give two ends.");
    const delta = [b.point[0] - a.point[0], b.point[1] - a.point[1], b.point[2] - a.point[2]];
    const lines = [
      `${a.name} to ${b.name}: ${fmt(Math.hypot(...delta))} m (x ${fmt(delta[0] ?? 0)}, y ${fmt(delta[1] ?? 0)}, ` +
        `z ${fmt(delta[2] ?? 0)}).`,
    ];
    if (a.box !== null && b.box !== null) {
      const { gap, length } = boxGap(a.box, b.box);
      lines.push(
        `Gap between the boxes: ${fmt(length)} m (x ${fmt(gap[0] ?? 0)}, y ${fmt(gap[1] ?? 0)}, z ${fmt(gap[2] ?? 0)}).`,
      );
    }
    return textResult(lines);
  },
});
