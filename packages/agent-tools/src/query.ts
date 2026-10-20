// SPDX-License-Identifier: Apache-2.0
/**
 * The tool `scene_query`: the entities of the open scene of the scene surface, by name, tag and component, with their
 * transforms, bounds and component values. The page answers the bridge call `scene.query` of `@scenity/bridge`. The
 * scene page answers from its scene document and its inspect report. The lab page answers from the scene document of
 * its plugin.
 */
import { SCENE_QUERY_CALL, type SceneQueryArgs, type SceneQueryEntity } from "@scenity/bridge";
import { z } from "zod";
import { callTyped, defineTool, fmt, textResult } from "./kit";

/** The words of a vector or a quaternion. */
function vec(values: readonly number[] | undefined): string {
  return values === undefined ? "?" : `[${values.map((value) => fmt(value)).join(", ")}]`;
}

/** The lines of one entity of the answer. */
export function entityLines(entity: SceneQueryEntity): string[] {
  const name = entity.name === null ? "" : ` "${entity.name}"`;
  const parent = entity.parent === null ? "root" : `under ${entity.parent}`;
  const tags = entity.tags.length === 0 ? "" : ` · tags ${entity.tags.join(", ")}`;
  const lines = [`${entity.id}${name} (${parent})${tags} · components ${entity.components.join(", ") || "none"}`];
  const world = entity.world;
  if (world !== null) {
    lines.push(`    world position ${vec(world.position)} rotation ${vec(world.rotation)} scale ${vec(world.scale)}`);
  }
  const local = entity.local;
  if (local !== null && world !== null && entity.parent !== null) {
    lines.push(`    local position ${vec(local.position)} rotation ${vec(local.rotation)} scale ${vec(local.scale)}`);
  }
  if (entity.bounds !== null) lines.push(`    bounds min ${vec(entity.bounds.min)} max ${vec(entity.bounds.max)}`);
  if (entity.values !== undefined) lines.push(`    values ${JSON.stringify(entity.values)}`);
  return lines;
}

export const sceneQuery = defineTool({
  name: "scene_query",
  description:
    "Query the open scene of the editor window: the entities by name, tag or component, with " +
    "their world and local transforms, their world bounds (from the last frame) and the values of their components. " +
    "`where` takes the search words of the hierarchy panel: name:<text>, tag:<text>, component:<text> or a plain " +
    "word; every word must match. No filter lists every entity (at most `limit`, in tree order).",
  input: z.object({
    where: z
      .string()
      .optional()
      .describe("Search words, for example 'tag:furniture component:model' or 'lamp'. Every word must match."),
    ids: z.array(z.string().min(1)).optional().describe("Only these entity IDs."),
    name: z.string().optional().describe("A part of the name or the ID (no case)."),
    tag: z.string().optional().describe("A part of a tag (no case)."),
    component: z.string().optional().describe("A part of a component ID (no case), for example 'light'."),
    under: z.string().optional().describe("Only this entity and the entities under it."),
    values: z
      .union([z.boolean(), z.array(z.string().min(1))])
      .optional()
      .describe("true: the values of every component; a list: the values of these components (default: none)."),
    limit: z.number().int().min(1).max(500).optional().describe("The most entities in the result (default 50)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const query = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as SceneQueryArgs;
    const answer = await callTyped(ctx.surface("visible"), SCENE_QUERY_CALL, [query]);
    const shown = answer.entities.length;
    const head =
      `${String(answer.matches)} of ${String(answer.total)} entities match` +
      (shown < answer.matches ? ` (the first ${String(shown)}; give a filter or a limit).` : ".");
    return textResult([head, ...answer.entities.flatMap(entityLines)]);
  },
});
