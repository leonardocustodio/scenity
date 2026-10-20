// SPDX-License-Identifier: Apache-2.0
// The external agents. A connection request waits for the owner. An allowed request gets a token and an agent session
// of the project. Its tool calls run in a turn of that session (the gate, the transcript). The host refuses a bad
// token, and a denied request gets no token.
import { describe, expect, test } from "bun:test";
import { defineTool } from "@scenity/agent-tools";
import { z } from "zod";
import { scriptDriver } from "../src/agents/driver";
import { AGENT_TOKEN_HEADER, Connections, externalApi } from "../src/agents/external";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const edit = defineTool({
  name: "scene_command",
  description: "edit",
  input: z.object({ command: z.string().optional() }),
  alwaysLoad: false,
  handler: () => Promise.resolve({ content: [{ type: "text", text: "Proposal p1" }] }),
});

function sessionsOf(events: unknown[] = []) {
  return new AgentSessions({
    driver: scriptDriver({ turns: [[]] }),
    hub: new BridgeHub(),
    dirOf: () => null,
    emit: (event) => events.push(event),
    tools: [edit],
  });
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://studio${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://studio${path}`, { headers });

async function call(sessions: AgentSessions, request: Request): Promise<Record<string, unknown>> {
  const answer = await externalApi(sessions, request, new URL(request.url));
  if (answer === null) throw new Error("no answer");
  return (await answer.json()) as Record<string, unknown>;
}

describe("the external agents", () => {
  test("a request waits for the owner, an allowed one gets a session, and its calls run in a turn", async () => {
    const events: { type?: string }[] = [];
    const sessions = sessionsOf(events);
    const made = await call(sessions, post("/api/agent/connect", { name: "Claude Code" }));
    expect(made).toMatchObject({ name: "Claude Code", state: "pending", project: null });
    expect(events.at(-1)?.type).toBe("agent.connections");
    const id = String(made.id);
    expect(await call(sessions, get(`/api/agent/connect/${id}`))).toMatchObject({ state: "pending", token: null });
    expect(await call(sessions, post(`/api/agent/connections/${id}/allow`, {}))).toMatchObject({
      error: "give the project of the connection",
    });
    await call(sessions, post(`/api/agent/connections/${id}/allow`, { project: "showroom" }));
    const allowed = await call(sessions, get(`/api/agent/connect/${id}`));
    expect(allowed).toMatchObject({ state: "allowed", project: "showroom" });
    const token = String(allowed.token);
    const session = sessions.list().find((item) => item.id === allowed.session);
    expect(session).toMatchObject({ name: "Claude Code", external: true, mode: "review" });
    expect(() => sessions.prompt(String(allowed.session), "hello")).toThrow("takes no prompt");
    const tools = await call(sessions, get("/api/agent/external/tools", { [AGENT_TOKEN_HEADER]: token }));
    expect((tools.tools as { name: string }[]).map((tool) => tool.name)).toContain("scene_command");
    const result = await call(
      sessions,
      post(
        "/api/agent/external/call",
        { name: "scene_command", arguments: { command: "entity.rename" } },
        { [AGENT_TOKEN_HEADER]: token },
      ),
    );
    expect(result).toMatchObject({ content: [{ text: "Proposal p1" }] });
    const now = sessions.list().find((item) => item.id === allowed.session);
    expect(now?.running).toBe(true);
    expect(now?.items.map((item) => item.kind)).toEqual(["prompt", "tool"]);
    sessions.stop(String(allowed.session));
    expect(sessions.list().find((item) => item.id === allowed.session)).toMatchObject({ running: false });
  });

  test("a bad token is refused, and a denied request gets no token", async () => {
    const sessions = sessionsOf();
    const refused = await externalApi(
      sessions,
      get("/api/agent/external/tools", { [AGENT_TOKEN_HEADER]: "x" }),
      new URL("http://studio/api/agent/external/tools"),
    );
    expect(refused?.status).toBe(401);
    const made = await call(sessions, post("/api/agent/connect", { name: "Codex", project: "showroom" }));
    await call(sessions, post(`/api/agent/connections/${String(made.id)}/deny`, {}));
    expect(await call(sessions, get(`/api/agent/connect/${String(made.id)}`))).toMatchObject({
      state: "denied",
      token: null,
    });
    expect(
      await externalApi(sessions, get("/api/agent/sessions"), new URL("http://studio/api/agent/sessions")),
    ).toBeNull();
    const connections = new Connections();
    const view = connections.request("Cursor", null);
    expect(() => connections.deny("c99")).toThrow("No connection request c99.");
    connections.deny(view.id);
    expect(() => connections.allow(view.id, "s1", "showroom")).toThrow("is denied");
  });
});
