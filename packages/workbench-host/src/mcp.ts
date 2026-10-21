// SPDX-License-Identifier: Apache-2.0
/**
 * The stdio MCP server `workbench` for the Claude Code CLI. The CLI starts it from
 * the generated MCP config (settings.ts) with the environment `SCENITY_WORKBENCH_ORIGIN` and
 * `SCENITY_WORKBENCH_TOKEN`. It is a thin proxy: it lists the tools of the host (`GET <origin>/tools/`: the core tools,
 * the tools of the plugins of the project and of the page) and sends each call to the host as
 * `POST <origin>/tools/<name>` with the token header and the JSON input. The host runs the tool against its surfaces
 * and answers with the MCP result. A host that gives no list gets the list of this process (`toolListings`).
 *
 *   SCENITY_WORKBENCH_ORIGIN=http://127.0.0.1:<port> SCENITY_WORKBENCH_TOKEN=<64 hex> bun src/mcp.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HOST_PATHS, isHostOrigin, isRecord, isToken, TOKEN_ENV, TOKEN_HEADER } from "./protocol";
import { ORIGIN_ENV } from "./settings";
import { toolListings, type ToolListing } from "./tools/index";

/** The longest wait for the host to run a tool (ms): a frame or a check can take a minute. */
export const TOOL_CALL_TIMEOUT_MS = 180_000;

export interface ProxyOptions {
  readonly origin: string;
  readonly token: string;
  /** The fetch function (a test gives another). */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The time for the tool list of the host (ms). */
export const TOOL_LIST_TIMEOUT_MS = 10_000;

/** The tool list of the host (`GET /tools/`), or the host tools of this process when the host gives none. */
export async function hostToolList(options: ProxyOptions): Promise<ToolListing[]> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(`${options.origin}${HOST_PATHS.tools}`, {
      headers: { [TOKEN_HEADER]: options.token },
      signal: AbortSignal.timeout(TOOL_LIST_TIMEOUT_MS),
    });
    const body: unknown = response.ok ? await response.json() : null;
    if (isRecord(body) && Array.isArray(body.tools)) return body.tools as ToolListing[];
  } catch {
    // The list of this process is the fallback.
  }
  return toolListings();
}

/**
 * Send one tool call to the host and give its result, or a tool error when the host does not answer well. The host
 * knows the tools (they come from the project and the page), so the proxy sends each name.
 */
export async function forwardCall(options: ProxyOptions, name: string, input: unknown): Promise<CallToolResult> {
  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(`${options.origin}${HOST_PATHS.tools}${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: options.token, "content-type": "application/json" },
      body: JSON.stringify(input ?? {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? TOOL_CALL_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return errorResult(`The workbench host at ${options.origin} did not answer: ${reason}`);
  }
  if (!response.ok) {
    return errorResult(
      `The workbench host answered ${String(response.status)}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.content)) return errorResult("The workbench host gave no tool result.");
  return body as CallToolResult;
}

/**
 * Make the MCP server of the proxy (not yet connected to a transport). It sets the handlers of `tools/list` and
 * `tools/call` on the protocol server itself, because the tools come as JSON schemas and go to the host.
 */
export function createMcpProxy(options: ProxyOptions): McpServer {
  const mcp = new McpServer(
    { name: "workbench", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "The tools of the Scenity workbench: they read and drive the 3D room lab that the owner looks at.",
    },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await hostToolList(options) }));
  mcp.server.setRequestHandler(CallToolRequestSchema, (request) =>
    forwardCall(options, request.params.name, request.params.arguments ?? {}),
  );
  return mcp;
}

/** Read the endpoint of the host from the environment, or throw an error that names the variable. */
export function endpointFromEnv(env: Readonly<Record<string, string | undefined>>): { origin: string; token: string } {
  const origin = env[ORIGIN_ENV];
  const token = env[TOKEN_ENV];
  if (!isHostOrigin(origin)) throw new Error(`${ORIGIN_ENV} must be http://127.0.0.1:<port>.`);
  if (!isToken(token)) throw new Error(`${TOKEN_ENV} must be the launch token of the host (64 hex characters).`);
  return { origin, token };
}

if (import.meta.main) {
  try {
    const server = createMcpProxy(endpointFromEnv(process.env));
    await server.connect(new StdioServerTransport());
  } catch (error) {
    process.stderr.write(`workbench mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
