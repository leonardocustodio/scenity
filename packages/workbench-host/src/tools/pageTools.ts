// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of the page: the editor plugins of the page of the scene surface give tools with a JSON Schema of their
 * input. The bridge call `tools` lists them, and `tools.call` runs one in the page. The host adds them to the MCP
 * tool list after its own tools. A page tool with the name of a host tool is not in the list.
 */
import { PAGE_TOOL_CALL, PAGE_TOOLS_CALL, type PageToolInfo } from "@scenity/bridge";
import type { ToolContext } from "./context";
import { callTyped, FRAME_TIMEOUT_MS, type ToolResult } from "./kit";

/** The time for the list of the page tools (ms): a page that does not answer gives no tools. */
export const PAGE_TOOLS_TIMEOUT_MS = 3_000;

/** The tools of the page of the visible scene frame, without the names in `taken`. A failed call gives none. */
export async function pageTools(ctx: ToolContext, taken: ReadonlySet<string>): Promise<PageToolInfo[]> {
  try {
    const tools = await callTyped(ctx.surface("visible"), PAGE_TOOLS_CALL, [], PAGE_TOOLS_TIMEOUT_MS);
    return tools.filter((tool) => !taken.has(tool.name));
  } catch {
    return [];
  }
}

/** Run one tool of the page and give its result in the shape of MCP. */
export async function runPageTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const args = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  const result = await callTyped(
    ctx.surface("visible"),
    PAGE_TOOL_CALL,
    [name, args as Record<string, unknown>],
    FRAME_TIMEOUT_MS,
  );
  return { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) };
}
