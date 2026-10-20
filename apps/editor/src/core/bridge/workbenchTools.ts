// SPDX-License-Identifier: Apache-2.0
/**
 * The page tools and the page lines of the context packet: the bridge calls `tools`, `tools.call` and `contextLines`
 * of `@scenity/bridge`. The editor plugin gives the tools (`EditorPlugin.tools`) and the lines
 * (`EditorPlugin.contextLines`). A page with no plugin part gives no tools and no lines.
 */
import {
  CONTEXT_LINES_CALL,
  PAGE_TOOL_CALL,
  PAGE_TOOLS_CALL,
  serveBridgeCall,
  type PageToolInfo,
  type PageToolResult,
} from "@scenity/bridge";
import { registeredPlugin, type PageTool } from "../plugin";

/** The tools of the registered plugin. */
function tools(): readonly PageTool[] {
  return registeredPlugin()?.tools ?? [];
}

/** The tools of the page without their run functions. */
export function pageToolList(): PageToolInfo[] {
  return tools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Run one tool of the page. Throws for a name that no tool has. */
export async function runPageTool(name: string, input: Record<string, unknown>): Promise<PageToolResult> {
  const tool = tools().find((item) => item.name === name);
  if (tool === undefined) {
    const names = tools().map((item) => item.name);
    throw new Error(`No page tool "${name}". Tools: ${names.join(", ")}.`);
  }
  const result = await tool.run(input);
  return typeof result === "string" ? { text: result, isError: false } : result;
}

/** The lines of the context packet from the registered plugin. */
export async function pageContextLines(): Promise<string[]> {
  return [...((await registeredPlugin()?.contextLines?.()) ?? [])];
}

/** The calls of the bridge for the page tools and the page lines. */
export const PAGE_BRIDGE_CALLS = {
  [PAGE_TOOLS_CALL.name]: serveBridgeCall(PAGE_TOOLS_CALL, pageToolList),
  [PAGE_TOOL_CALL.name]: serveBridgeCall(PAGE_TOOL_CALL, runPageTool),
  [CONTEXT_LINES_CALL.name]: serveBridgeCall(CONTEXT_LINES_CALL, pageContextLines),
} as const;
