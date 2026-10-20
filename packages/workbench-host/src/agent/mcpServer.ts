// SPDX-License-Identifier: Apache-2.0
/**
 * The in-process MCP server `workbench` of the chat mode. It serves the same registry as the stdio server of the
 * terminal mode (src/mcp.ts), with the same two request handlers. `tools/list` gives the listing of the host tools
 * (the JSON schemas from zod and the `alwaysLoad` hints) and the tools of the page. `tools/call` runs
 * `handleToolRequest`, as the host route `POST /tools/<name>` does. Thus both modes run one implementation of each tool.
 *
 * The server comes from `createSdkMcpServer` with one `tool()` per entry (the SDK then knows the tools and their load
 * hints). The SDK bundles its own copy of zod, and its JSON schema step fails on the schemas of the zod of the host
 * (SDK 0.3.284: "ctx.deferred.push"). So the host sets its own two handlers on the protocol server, as src/mcp.ts does.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCP_SERVER_NAME } from "../settings";
import { pageTools } from "../tools/pageTools";
import { handleToolRequest, toolListings, workbenchTools, type ToolContext, type ToolDef } from "../tools/index";
import type { McpSdkServerConfigWithInstance } from "./sdk";

/** The instructions of the server (the same words as the stdio server). */
export const SERVER_INSTRUCTIONS =
  "The tools of the Scenity workbench: they read and drive the 3D room lab that the owner looks at.";

/** Run one tool for the server. */
async function runTool(name: string, input: unknown, context: () => ToolContext): Promise<CallToolResult> {
  return (await handleToolRequest(name, input ?? {}, context())) as CallToolResult;
}

/** The SDK tool of one workbench tool. */
function sdkTool(def: ToolDef, context: () => ToolContext): ReturnType<typeof tool> {
  return tool(
    def.name,
    def.description,
    def.input.shape,
    (args) => runTool(def.name, args, context),
    def.alwaysLoad ? { alwaysLoad: true } : {},
  );
}

/**
 * Make the in-process server. `context` gives the tool context of the open checkout at each call (the host gives the
 * same function as for its `/tools/` route).
 */
export function createWorkbenchServer(
  context: () => ToolContext,
  tools: readonly ToolDef[] = workbenchTools(),
): McpSdkServerConfigWithInstance {
  const config = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "0.1.0",
    instructions: SERVER_INSTRUCTIONS,
    tools: tools.map((def) => sdkTool(def, context)),
  });
  const names = new Set(tools.map((def) => def.name));
  const server = config.instance.server;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const page = await pageTools(context(), names);
    const own = toolListings(tools);
    return {
      tools: [...own, ...page.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    runTool(request.params.name, request.params.arguments, context),
  );
  return config;
}
