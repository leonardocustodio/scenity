// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of an editor window of the studio, and the two functions of an MCP server over them. The first gives the
 * MCP entry of each tool (its JSON schema from zod and the load hint of Claude Code). The second runs a tool after a
 * check of its input. The studio host serves the tools to its agent sessions.
 */
import { z } from "zod";
import type { SceneToolContext } from "./context";
import { sceneBatch, sceneCommand, sceneCommands } from "./edit";
import { errorResult, errorText, type ToolDef, type ToolResult } from "./kit";
import { noteList, noteResolve } from "./notes";
import { sceneQuery } from "./query";
import { scenePick, sceneSheet } from "./scenePick";
import { sceneFrame, sceneMeasure } from "./sceneView";
import { studioStateTool, uiHighlight, uiNotify, uiReveal, uiState } from "./ui";

/** The tools of an editor window of the studio, `studio_state` first. */
export const STUDIO_TOOLS: readonly ToolDef[] = [
  studioStateTool,
  sceneQuery,
  sceneCommands,
  sceneCommand,
  sceneBatch,
  sceneFrame,
  sceneMeasure,
  scenePick,
  sceneSheet,
  noteList,
  noteResolve,
  uiState,
  uiReveal,
  uiHighlight,
  uiNotify,
];

/** The MCP description of a tool: its name, its description, its JSON schema and the load hint. */
export interface ToolListing {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
  readonly _meta?: { readonly "anthropic/alwaysLoad": true };
}

/** The MCP listing of each tool (tools/list). */
export function listingsOf(tools: readonly ToolDef[]): ToolListing[] {
  return tools.map((tool) => {
    const schema: Record<string, unknown> = { ...z.toJSONSchema(tool.input, { io: "input" }) };
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: { ...schema, type: "object" },
      ...(tool.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } as const } : {}),
    };
  });
}

/** Run a tool of a list: check the input with its schema, then call its handler; a problem is a tool error. */
export async function runToolOf<C extends SceneToolContext>(
  tools: readonly ToolDef<z.ZodObject, C>[],
  name: string,
  input: unknown,
  ctx: C,
): Promise<ToolResult> {
  const tool = tools.find((item) => item.name === name);
  if (tool === undefined) return errorResult(`No tool "${name}". Tools: ${tools.map((item) => item.name).join(", ")}.`);
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    return errorResult(`${name}: ${issues}`);
  }
  try {
    return await tool.handler(parsed.data, ctx);
  } catch (error) {
    return errorResult(`${name}: ${errorText(error)}`);
  }
}
