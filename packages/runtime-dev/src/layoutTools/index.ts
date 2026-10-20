// SPDX-License-Identifier: Apache-2.0
/**
 * The generic layout tools: measure, reach spheres, clearance, walk paths and visibility on any entity with the
 * components that each tool needs. Each tool is a pure function of a metric context (`@scenity/rules`) and a request:
 * it runs the built-in metrics (`distance`, `reach`, `overlap`, `walkway`, `routeClear`, `visible`) and gives a readout
 * and the shapes of an overlay in the world frame. A tool with no input gives `ok: false` and the reason.
 *
 * The editor scene page makes the context from the inspect report of its core and draws the shapes on its overlay
 * canvas; a Bun test makes the context with `builderMetricContext` on a document core with no GPU.
 */
import type { MetricContext } from "@scenity/rules";
import { clearanceTool } from "./clearance";
import { measureTool } from "./measure";
import { reachTool } from "./reach";
import type { LayoutToolId, LayoutToolRequest, LayoutToolResult } from "./shared";
import { visibilityTool } from "./visibility";
import { walkTool } from "./walks";

export * from "./shared";
export { boxGap, CLEARANCE_DEFAULTS, neighboursOf, type Neighbour } from "./clearance";
export { REACH_DEFAULTS } from "./reach";
export { WALK_TOOL_DEFAULTS } from "./walks";

/** The label of each tool and what it needs, for the tool menu. */
export const LAYOUT_TOOLS: readonly { readonly id: LayoutToolId; readonly label: string; readonly needs: string }[] = [
  { id: "measure", label: "Measure", needs: "two selected entities or two picks" },
  { id: "reach", label: "Reach", needs: "an entity with a character component or a stand point" },
  { id: "clearance", label: "Clearance", needs: "one or more selected entities with a box" },
  { id: "walk", label: "Walk paths", needs: "an entity with a locomotion component, or two entities" },
  { id: "visibility", label: "Visibility", needs: "a target entity, and an eye entity or the camera" },
];

/** Run a layout tool on the scene of a metric context. */
export function runLayoutTool(ctx: MetricContext, request: LayoutToolRequest): LayoutToolResult {
  switch (request.tool) {
    case "measure":
      return measureTool(ctx, request);
    case "reach":
      return reachTool(ctx, request);
    case "clearance":
      return clearanceTool(ctx, request);
    case "walk":
      return walkTool(ctx, request);
    case "visibility":
      return visibilityTool(ctx, request);
  }
}
