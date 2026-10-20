// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the in-process MCP server and the hook callbacks of the chat mode. The SDK server lists the same tools as
 * the stdio server of the terminal mode, and a call runs the same handler. Each hook callback gives the same answer
 * as the host route `POST /hooks/<event>`.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWorkbenchServer } from "../src/agent/mcpServer";
import { sdkHooks } from "../src/agent/sdkHooks";
import { createTurnLog, handleHook, type HookDeps } from "../src/hooks";
import { HOOKS } from "../src/settings";
import { handleToolRequest, toolListings } from "../src/tools/index";
import { fakeContext, fakeLab } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

async function connect(): Promise<Client> {
  const server = createWorkbenchServer(() => fakeContext(fakeLab().port));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverSide);
  const client = new Client({ name: "workbench-test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("the in-process MCP server", () => {
  test("lists the same tools, descriptions and load hints as the stdio server", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const stdio = toolListings();
    expect(tools.map((tool) => tool.name)).toEqual(stdio.map((tool) => tool.name));
    expect(tools.map((tool) => tool.description)).toEqual(stdio.map((tool) => tool.description));
    const loaded = (list: readonly { name: string; _meta?: Record<string, unknown> | undefined }[]) =>
      list.filter((tool) => tool._meta?.["anthropic/alwaysLoad"] === true).map((tool) => tool.name);
    expect(loaded(tools)).toEqual(loaded(stdio));
    expect(loaded(tools)).toContain("lab_frame");
    for (const tool of tools) {
      const twin = stdio.find((item) => item.name === tool.name);
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(
        Object.keys((twin?.inputSchema.properties as Record<string, unknown> | undefined) ?? {}).sort(),
      );
    }
    await client.close();
  });

  test("a call runs the same handler as the host route, the image included", async () => {
    const client = await connect();
    const input = { t: 6350, camera: "side", width: 640 };
    const viaSdk = await client.callTool({ name: "lab_frame", arguments: input });
    const viaRoute = await handleToolRequest("lab_frame", input, fakeContext(fakeLab().port));
    expect(viaSdk.content).toEqual(viaRoute.content as never);
    expect((viaSdk.content as { type: string }[]).some((block) => block.type === "image")).toBe(true);
    await client.close();
  });
});

describe("the hook callbacks", () => {
  const deps = (): HookDeps => ({ packet: () => "Workbench context · greet at 6350 ms", turns: createTurnLog() });
  const signal = new AbortController().signal;

  test("have the events, matchers and timeouts of the generated settings", () => {
    const hooks = sdkHooks(deps);
    for (const { event, matcher, timeout } of HOOKS) {
      expect(hooks[event]?.[0]?.matcher).toBe(matcher);
      expect(hooks[event]?.[0]?.timeout).toBe(timeout);
    }
  });

  test("UserPromptSubmit adds the context packet", async () => {
    const callback = sdkHooks(deps).UserPromptSubmit?.[0]?.hooks[0];
    const input = { hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: "/repo", prompt: "fix the hat" };
    const out = await callback?.(input as never, undefined, { signal });
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "Workbench context · greet at 6350 ms",
      },
    });
  });

  test("PreToolUse refuses a Git push as the route does", async () => {
    const callback = sdkHooks(deps).PreToolUse?.[0]?.hooks[0];
    const input = {
      hook_event_name: "PreToolUse",
      session_id: "s-1",
      tool_name: "Bash",
      tool_input: { command: "git push" },
    };
    const out = await callback?.(input as never, "tu-1", { signal });
    expect(out).toEqual(await handleHook("PreToolUse", input, deps()));
    expect(JSON.stringify(out)).toContain('"permissionDecision":"deny"');
  });

  test("PostToolUse of an Edit adds the file to the turn", async () => {
    const shared = deps();
    const edits: string[] = [];
    const callback = sdkHooks(() => ({ ...shared, onEdit: (info) => edits.push(info.file) })).PostToolUse?.[0]
      ?.hooks[0];
    const input = {
      hook_event_name: "PostToolUse",
      session_id: "s-1",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/a.ts" },
    };
    await callback?.(input as never, "tu-1", { signal });
    expect(edits).toEqual(["/repo/a.ts"]);
  });
});
