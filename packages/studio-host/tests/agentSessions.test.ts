// SPDX-License-Identifier: Apache-2.0
// The agent sessions of the studio. A prompt runs a turn of the script driver, and its tool calls go to the editor
// window of the project. The mode applies to the edit tools. A prompt during a turn waits in the queue, and Stop ends
// the turn. The API makes, changes, stops and closes a session, and the events go on /events.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_HEADER } from "../src/access";
import { contextPacket, readChips } from "../src/agents/context";
import { scriptDriver, type ScriptStep } from "../src/agents/driver";
import type { AgentEvent, AgentItem } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub, type BridgeSocket } from "../src/bridgeHub";
import { freePort } from "../src/process";
import { startStudio } from "../src/server";

/** A window of a project that answers each call with the answer of `answer`. */
function windowOf(hub: BridgeHub, answer: (call: string, args: readonly unknown[]) => unknown): unknown[][] {
  const calls: unknown[][] = [];
  const socket: BridgeSocket = {
    send(text) {
      const message = JSON.parse(text) as { id: number; call?: string; args: unknown[] };
      // A presence message is not a call.
      const { call } = message;
      if (call === undefined) return;
      calls.push([call, ...message.args]);
      queueMicrotask(() =>
        hub.message(socket, JSON.stringify({ workbench: 1, id: message.id, result: answer(call, message.args) })),
      );
    },
  };
  hub.attach(socket);
  hub.message(socket, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
  return calls;
}

/** The answers of a window: no listed commands, a URL, and `command` for a command run. */
function answers(command: unknown): (call: string) => unknown {
  return (call) => (call === "commands" ? [] : call === "url" ? "http://127.0.0.1/p/showroom" : command);
}

/** Sessions over a script with one turn, and the events. */
function sessionsOf(steps: readonly ScriptStep[], command: unknown = { kind: "applied" }) {
  const hub = new BridgeHub();
  const calls = windowOf(hub, answers(command));
  const events: AgentEvent[] = [];
  const sessions = new AgentSessions({
    driver: scriptDriver({ turns: [steps] }),
    hub,
    dirOf: () => null,
    emit: (event) => events.push(event),
  });
  return { sessions, calls, events };
}

/** Wait until the session has no turn that runs. */
async function idle(sessions: AgentSessions, id: string): Promise<readonly AgentItem[]> {
  for (let i = 0; i < 200; i += 1) {
    const session = sessions.list().find((item) => item.id === id);
    if (session !== undefined && !session.running) return session.items;
    await Bun.sleep(5);
  }
  throw new Error("the turn did not end");
}

const COMMAND: ScriptStep = { tool: "scene_command", input: { command: "entity.create" } };

describe("the agent sessions of the studio", () => {
  test("a prompt runs a turn: the text, the tool call to the window and the cost", async () => {
    const { sessions, calls, events } = sessionsOf(
      [{ say: "Adding {prompt}." }, COMMAND, { cost: 0.02, context: 0.1 }],
      { kind: "applied", id: "entity.create", title: "Create entity" },
    );
    const session = sessions.create("showroom", { mode: "auto" });
    expect(session.colour).toBe("agent-1");
    expect(sessions.create("showroom").colour).toBe("agent-2");
    sessions.prompt(session.id, "a lamp");
    const items = await idle(sessions, session.id);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "text", "tool", "end"]);
    expect(items[1]).toMatchObject({ text: "Adding a lamp." });
    expect(items[2]).toMatchObject({ name: "scene_command", isError: false });
    expect(calls.some(([call]) => call === "command")).toBe(true);
    const info = sessions.list().find((item) => item.id === session.id);
    expect(info).toMatchObject({ costUsd: 0.02, contextShare: 0.1, running: false });
    expect(events.some((event) => event.type === "agent.item")).toBe(true);
  });

  test("Ask refuses an edit tool; Review sends it as a proposal", async () => {
    const { sessions, calls } = sessionsOf([COMMAND], { kind: "proposed", id: "p1" });
    const ask = sessions.create("showroom", { mode: "ask" });
    sessions.prompt(ask.id, "edit");
    const asked = await idle(sessions, ask.id);
    expect(asked[1]).toMatchObject({ kind: "tool", isError: true });
    // Only the checkpoint of the turn reached the window.
    expect(calls).toEqual([["turn.checkpoint", ask.id, 1]]);
    const review = sessions.create("showroom", { mode: "review" });
    sessions.prompt(review.id, "edit");
    const reviewed = await idle(sessions, review.id);
    expect(reviewed[1]).toMatchObject({ kind: "tool", input: { command: "entity.create", mode: "propose" } });
    const sent = calls.find(([call]) => call === "command");
    expect(JSON.stringify(sent)).toContain('"mode":"propose"');
  });

  test("a prompt during a turn waits; Stop ends the turn and clears the queue", async () => {
    const { sessions } = sessionsOf([{ wait: 5000 }, { say: "never" }]);
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "one");
    expect(sessions.prompt(session.id, "two")).toEqual({ queued: 1 });
    sessions.stop(session.id);
    const items = await idle(sessions, session.id);
    expect(items.map((item) => item.kind)).toEqual(["prompt", "end"]);
    expect(items[1]).toMatchObject({ reason: "stopped" });
    expect(sessions.list()[0]?.queued).toBe(0);
  });

  test("a fork copies the transcript and the options, and its next turn continues the script", async () => {
    const hub = new BridgeHub();
    windowOf(hub, answers({ kind: "applied" }));
    const sessions = new AgentSessions({
      driver: scriptDriver({ turns: [[{ say: "one" }], [{ say: "two" }]] }),
      hub,
      dirOf: () => null,
      emit: () => undefined,
    });
    const source = sessions.create("showroom", { name: "Chairs", mode: "auto", effort: "low" });
    sessions.prompt(source.id, "first");
    await idle(sessions, source.id);
    const fork = sessions.fork(source.id);
    expect(fork).toMatchObject({ name: "Chairs (fork)", mode: "auto", effort: "low" });
    expect(fork.items.map((item) => item.kind)).toEqual(["prompt", "text", "end"]);
    sessions.prompt(fork.id, "second");
    const items = await idle(sessions, fork.id);
    expect(items.at(-2)).toMatchObject({ kind: "text", text: "two", id: 5 });
  });

  test("the chips of a prompt go in the packet and in the prompt item; a bad chip goes", async () => {
    const chips = readChips([
      { kind: "selection", label: "Table", text: "table (Table)" },
      {
        kind: "picture",
        label: "View",
        text: "a region of the Scene view",
        picture: { mime: "image/webp", data: "AAAA" },
      },
      { kind: "bad" },
      { kind: "picture", label: "Odd", text: "odd", picture: { mime: "image/gif", data: "AAAA" } },
    ]);
    expect(chips.map((chip) => chip.picture?.mime ?? null)).toEqual([null, "image/webp", null]);
    expect(contextPacket(chips)).toBe(
      "<studio-context>\n- selection: table (Table)\n- picture: a region of the Scene view (a picture)\n- picture: odd\n</studio-context>",
    );
    const { sessions } = sessionsOf([{ say: "{context}" }]);
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "light it", chips.slice(0, 2));
    const items = await idle(sessions, session.id);
    expect(items[0]).toMatchObject({
      kind: "prompt",
      context: [
        { kind: "selection", label: "Table", picture: false },
        { kind: "picture", label: "View", picture: true },
      ],
    });
    expect(JSON.stringify(items[0])).not.toContain("AAAA");
    const said = items[1];
    expect(said?.kind === "text" ? said.text : "").toContain("- selection: table (Table)");
  });

  test("a failed turn is an error item; a closed session goes", async () => {
    const { sessions, events } = sessionsOf([{ tool: "scene_command", input: {} }]);
    const session = sessions.create("showroom", { name: "Chairs" });
    sessions.update(session.id, { mode: "auto", effort: "low", name: " " });
    expect(sessions.list()[0]).toMatchObject({ name: "Chairs", mode: "auto", effort: "low" });
    sessions.prompt(session.id, "go");
    const items = await idle(sessions, session.id);
    expect(items[1]).toMatchObject({ kind: "tool", isError: true });
    expect(() => sessions.prompt(session.id, " ")).toThrow("empty");
    sessions.close(session.id);
    expect(sessions.list()).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "agent.closed", session: session.id });
  });
});

describe("the API of the agent sessions", () => {
  test("makes a session, sends a prompt, changes the mode, stops and closes it; events go on /events", async () => {
    const root = mkdtempSync(join(tmpdir(), "studio-agents-"));
    const studio = await startStudio({
      port: await freePort(),
      stateDir: join(root, "state"),
      sceneServer: () => null,
      roots: [root],
      agents: scriptDriver({ turns: [[{ say: "Hello {prompt}." }]] }),
    });
    const headers = { [TOKEN_HEADER]: studio.access.secret, "content-type": "application/json" };
    const api = async (path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(`${studio.origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return (await response.json()) as Record<string, unknown>;
    };
    try {
      const socket = new WebSocket(`${studio.origin.replace("http", "ws")}/events`, { headers } as never);
      const events: { type: string }[] = [];
      socket.onmessage = (message) => events.push(JSON.parse(String(message.data)) as { type: string });
      await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
      const made = await api("/api/agent/sessions", "POST", { project: "showroom", mode: "ask" });
      const id = String(made.id);
      expect(made).toMatchObject({ project: "showroom", mode: "ask", colour: "agent-1" });
      expect(await api(`/api/agent/sessions/${id}`, "PATCH", { mode: "auto", model: "sonnet" })).toMatchObject({
        mode: "auto",
        model: "sonnet",
      });
      await api(`/api/agent/sessions/${id}/prompt`, "POST", { text: "there" });
      const listing = await api("/api/agent/sessions?project=showroom");
      expect(listing).toMatchObject({ driver: "script", modes: ["ask", "review", "auto"] });
      expect(await api(`/api/agent/sessions/${id}/prompt`, "POST", { text: "" })).toMatchObject({
        error: "The prompt is empty.",
      });
      expect(await api(`/api/agent/sessions/${id}/stop`, "POST", {})).toEqual({ ok: true });
      expect(await api(`/api/agent/sessions/${id}`, "DELETE")).toEqual({ ok: true });
      expect((await api("/api/agent/sessions")).sessions).toEqual([]);
      await Bun.sleep(50);
      expect(new Set(events.map((event) => event.type))).toEqual(
        new Set(["agent.session", "agent.item", "agent.closed"]),
      );
      socket.close();
    } finally {
      await studio.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
