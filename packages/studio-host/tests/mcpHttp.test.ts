// SPDX-License-Identifier: Apache-2.0
// The MCP server of the studio over HTTP: an MCP client of the SDK lists the tools and calls one as the session of its
// connection. A request with no token, or with a revoked token, gets 401.
import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Connections, type ExternalSessions } from "../src/agents/external";
import { bearerToken, MCP_PATH, mcpHttp } from "../src/agents/mcpHttp";

const calls: [string, string, unknown][] = [];
const connections = new Connections();
const sessions: ExternalSessions = {
  connections,
  connectionsChanged: () => undefined,
  create: () => ({ id: "s1" }),
  external: (session, name, input) => {
    calls.push([session, name, input]);
    return Promise.resolve({ content: [{ type: "text", text: `moved by ${session}` }] });
  },
  externalTools: () => [
    { name: "scene_command", description: "Run a command of the scene.", inputSchema: { type: "object" } },
  ],
};
const server = Bun.serve({
  port: 0,
  fetch: (request) =>
    new URL(request.url).pathname === MCP_PATH ? mcpHttp(sessions, request) : new Response(null, { status: 404 }),
});
afterAll(() => {
  void server.stop(true);
});
const url = new URL(`http://127.0.0.1:${String(server.port)}${MCP_PATH}`);

async function client(token: string): Promise<Client> {
  const made = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // The transport type of the SDK has optional fields that the strict options of the checkout do not take.
  await made.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  return made;
}

describe("the MCP server over HTTP", () => {
  test("reads the token of the Authorization header", () => {
    expect(bearerToken(new Request(url, { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(bearerToken(new Request(url))).toBeNull();
  });

  test("lists the tools and runs a call as the session of the connection", async () => {
    const { token } = connections.add("Codex", "lobby", "s1");
    const mcp = await client(token);
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toEqual(["scene_command"]);
    const result = await mcp.callTool({ name: "scene_command", arguments: { command: "entity.move" } });
    expect(result.content).toEqual([{ type: "text", text: "moved by s1" }]);
    expect(calls).toEqual([["s1", "scene_command", { command: "entity.move" }]]);
    await mcp.close();
  });

  test("answers a plain JSON-RPC call with no MCP session (a curl, an e2e)", async () => {
    const { token } = connections.add("Plain", "lobby", "s3");
    const answer = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "scene_command", arguments: {} },
      }),
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ id: 1, result: { content: [{ text: "moved by s3" }] } });
  });

  test("refuses a request with no token and a revoked connection", async () => {
    const plain = await fetch(url, { method: "POST", body: "{}" });
    expect(plain.status).toBe(401);
    const { view, token } = connections.add("Cursor", "lobby", "s2");
    connections.revoke(view.id);
    expect(connections.get(view.id)?.state).toBe("denied");
    const refused = await client(token).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(Error);
  });
});
