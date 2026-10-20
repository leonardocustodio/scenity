#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The MCP server of Scenity Studio over stdio: an external agent (Claude Code, Codex, Cursor,
 * Claude Desktop) starts it as its MCP server. `scenity mcp` of `@scenity/cli` runs it.
 *
 *   scenity mcp [--name <client>] [--project <key>] [--studio <origin>] [--state <dir>]
 *
 * It reads the origin and the secret of the studio that runs (`host.json` of the studio state folder), asks the studio
 * for a connection (the owner allows it in the agent panel or the Hub), and then serves the agent tools of the studio:
 * each tool call goes to `POST /api/agent/external/call` and runs as an action of the agent session of the connection,
 * with its gate, its presence and its change sets. The messages for a person go to stderr.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOKEN_HEADER } from "./access";
import { AGENT_TOKEN_HEADER } from "./agents/external";
import { studioStateDir } from "./store";

/** The wait between two looks at the connection request (ms). */
const POLL_MS = 1000;

/** The options of the server. */
export interface McpOptions {
  readonly origin: string;
  readonly secret: string;
  readonly name: string;
  readonly project: string | null;
  readonly log: (line: string) => void;
}

/** Ask the studio for a connection and wait for the owner; the token, or an error when the owner denies it. */
export async function connect(options: McpOptions, wait = POLL_MS): Promise<string> {
  const headers = { [TOKEN_HEADER]: options.secret, "content-type": "application/json" };
  const made = await fetch(`${options.origin}/api/agent/connect`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: options.name, ...(options.project === null ? {} : { project: options.project }) }),
  });
  if (!made.ok) throw new Error(`the studio did not take the connection request (${String(made.status)})`);
  const { id } = (await made.json()) as { id: string };
  options.log(`Scenity: allow the connection of ${options.name} in the studio (the agent panel or Hub → Agents).`);
  for (;;) {
    const state = (await (await fetch(`${options.origin}/api/agent/connect/${id}`, { headers })).json()) as {
      state?: string;
      token?: string | null;
    };
    if (state.state === "allowed" && typeof state.token === "string") return state.token;
    if (state.state === "denied") throw new Error("the owner denied the connection");
    await Bun.sleep(wait);
  }
}

/**
 * The MCP server over a token of an allowed connection. It sets the handlers of `tools/list` and `tools/call` on the
 * protocol server itself, because the tools come as JSON schemas from the studio.
 */
export function mcpServer(options: McpOptions, token: string): McpServer {
  const headers = { [TOKEN_HEADER]: options.secret, [AGENT_TOKEN_HEADER]: token, "content-type": "application/json" };
  const mcp = new McpServer(
    { name: "scenity", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "The tools of Scenity Studio: they read and edit the open scene of the person, as an agent session.",
    },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const answer = (await (await fetch(`${options.origin}/api/agent/external/tools`, { headers })).json()) as {
      tools?: unknown[];
    };
    return { tools: (answer.tools ?? []) as never[] };
  });
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const answer = await fetch(`${options.origin}/api/agent/external/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: request.params.name, arguments: request.params.arguments ?? {} }),
    });
    const result = (await answer.json()) as CallToolResult & { error?: string };
    if (!answer.ok)
      return { content: [{ type: "text", text: result.error ?? "the studio refused the call" }], isError: true };
    return result;
  });
  return mcp;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: "string", default: "An external agent" },
      project: { type: "string" },
      studio: { type: "string" },
      state: { type: "string" },
    },
  });
  const state = values.state ?? studioStateDir();
  const host = JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { origin: string; secret: string };
  const options: McpOptions = {
    origin: values.studio ?? host.origin,
    secret: host.secret,
    name: values.name,
    project: values.project ?? null,
    log: (line) => console.error(line),
  };
  const token = await connect(options);
  options.log("Scenity: connected.");
  await mcpServer(options, token).connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Scenity: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
