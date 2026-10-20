// SPDX-License-Identifier: Apache-2.0
/**
 * The MCP server of Scenity Studio over HTTP: `POST /mcp` of the host. It uses the Streamable HTTP transport of MCP
 * with no MCP session (each request has its own server) and JSON answers. A client sends the token of its connection:
 * `Authorization: Bearer <token>`. The owner makes the connection and its token in Hub → Agents ("Connect over HTTP").
 * The stdio server (`scenity mcp`) gets its token by a connection request.
 * Each tool call runs as an action of the agent session of the connection, with its gate, its presence and its change
 * sets, as a call of the stdio server does.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExternalSessions } from "./external";

/** The path of the MCP server over HTTP. */
export const MCP_PATH = "/mcp";

/** The token of a request: the value of `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

/** A JSON-RPC error with no request ID (the transport has not read the request). */
function rpcError(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status });
}

/** Answer one request of `/mcp`. */
export async function mcpHttp(sessions: ExternalSessions, request: Request): Promise<Response> {
  const session = sessions.connections.sessionOf(bearerToken(request));
  if (session === null) {
    return rpcError(401, "No connection: make one in Scenity Studio (Hub → Agents → Connect over HTTP).");
  }
  const mcp = new McpServer(
    { name: "scenity", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "The tools of Scenity Studio: they read and edit the open scene of the person, as an agent session.",
    },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: sessions.externalTools() as never[] }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (call): Promise<CallToolResult> => {
    try {
      return (await sessions.external(session, call.params.name, call.params.arguments ?? {})) as CallToolResult;
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });
  // No session ID generator: the transport keeps no MCP session (each request stands alone).
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await mcp.connect(transport);
  return transport.handleRequest(request);
}
