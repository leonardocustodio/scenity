// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the stdio MCP server of the workbench: the MCP SDK client starts `bun src/mcp.ts` over stdio against a
 * fake host (`Bun.serve`). The server lists the tools of the host (`GET /tools/`). It sends each call to
 * `POST /tools/<name>` with the token header.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { endpointFromEnv, forwardCall, hostToolList } from "../src/mcp";
import { toolListings } from "../src/tools/index";
import { MCP_SCRIPT, ORIGIN_ENV } from "../src/settings";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "cd".repeat(32);
/** A tool of the page in the list of the fake host. */
const PAGE_TOOL = {
  name: "scene_lamps",
  description: "The lamps of the scene and their light values.",
  inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
};
const seen: { path: string; token: string | null; body: unknown }[] = [];
let host: ReturnType<typeof Bun.serve>;
let origin = "";

beforeAll(() => {
  host = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      // The tool list of the host: the host tools and one tool of the page.
      if (request.method === "GET" && url.pathname === "/tools/") {
        return Response.json({ tools: [...toolListings(), PAGE_TOOL] });
      }
      seen.push({ path: url.pathname, token: request.headers.get("x-workbench-token"), body: await request.json() });
      if (url.pathname === "/tools/lab_frame") {
        return Response.json({
          content: [
            { type: "text", text: "Frame at 6350 ms" },
            { type: "image", data: "UklGRiQAAABXRUJQ", mimeType: "image/webp" },
          ],
        });
      }
      return Response.json({ content: [{ type: "text", text: "scene_check: No scene." }], isError: true });
    },
  });
  origin = `http://127.0.0.1:${String(host.port)}`;
});

afterAll(async () => {
  await host.stop(true);
});

async function connect(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SCRIPT],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "workbench-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("the stdio MCP server", () => {
  test(
    "lists the tools and forwards the calls with the token, the image included",
    async () => {
      const client = await connect({ [ORIGIN_ENV]: origin, SCENITY_WORKBENCH_TOKEN: TOKEN });
      const list = await client.listTools();
      // The 32 core tools (CORE_TOOLS), the two aliases of the lab fixture (lab_commands and lab_edit) and the one
      // tool of the page.
      expect(list.tools).toHaveLength(35);
      expect(list.tools.at(-1)).toMatchObject(PAGE_TOOL);
      const frame = list.tools.find((tool) => tool.name === "lab_frame");
      expect(frame?._meta?.["anthropic/alwaysLoad"]).toBe(true);
      expect(frame?.inputSchema.properties).toHaveProperty("camera");
      const result = await client.callTool({ name: "lab_frame", arguments: { t: 6350, camera: "side" } });
      expect(result.content).toEqual([
        { type: "text", text: "Frame at 6350 ms" },
        { type: "image", data: "UklGRiQAAABXRUJQ", mimeType: "image/webp" },
      ]);
      expect(seen.at(-1)).toEqual({ path: "/tools/lab_frame", token: TOKEN, body: { t: 6350, camera: "side" } });
      const failed = await client.callTool({ name: "scene_check", arguments: {} });
      expect(failed.isError).toBe(true);
      await client.close();
    },
    ciWaitMs(20_000),
  );

  test("does not start without the endpoint in its environment", async () => {
    const child = Bun.spawn([process.execPath, MCP_SCRIPT], { env: { PATH: process.env.PATH ?? "" }, stderr: "pipe" });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("SCENITY_WORKBENCH_ORIGIN");
  });
});

describe("forwardCall", () => {
  test("hostToolList gives the list of the host, else the host tools of the process", async () => {
    expect((await hostToolList({ origin, token: TOKEN })).map((tool) => tool.name)).toContain("scene_lamps");
    const down = await hostToolList({ origin: "http://127.0.0.1:9", token: TOKEN });
    expect(down.map((tool) => tool.name)).toEqual(toolListings().map((tool) => tool.name));
  });

  test("gives a tool error when the host is down or answers 401", async () => {
    const down = await forwardCall({ origin: "http://127.0.0.1:9", token: TOKEN, timeoutMs: 2_000 }, "lab_state", {});
    expect(down.isError).toBe(true);
    expect(JSON.stringify(down.content)).toContain("did not answer");
    const denied = await forwardCall(
      {
        origin,
        token: TOKEN,
        fetch: (() => Promise.resolve(new Response("no", { status: 401 }))) as unknown as typeof fetch,
      },
      "lab_state",
      {},
    );
    expect(JSON.stringify(denied.content)).toContain("answered 401");
    expect((await forwardCall({ origin, token: TOKEN }, "lab_fly", {})).isError).toBe(true);
  });

  test("endpointFromEnv checks the origin and the token", () => {
    expect(endpointFromEnv({ [ORIGIN_ENV]: origin, SCENITY_WORKBENCH_TOKEN: TOKEN })).toEqual({
      origin,
      token: TOKEN,
    });
    expect(() => endpointFromEnv({ [ORIGIN_ENV]: "http://example.com", SCENITY_WORKBENCH_TOKEN: TOKEN })).toThrow();
    expect(() => endpointFromEnv({ [ORIGIN_ENV]: origin })).toThrow("SCENITY_WORKBENCH_TOKEN");
  });
});
