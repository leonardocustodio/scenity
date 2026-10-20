// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the chat mode of the host against a fake Agent SDK: the credential rule, the options, the prompt queue, the
 * approvals and the questions, interrupt, the loop error, resume and fork, and the routes. No test starts Claude
 * Code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { AgentManager, NO_KEY_MESSAGE } from "../src/agent/index";
import { addAgentHandlers } from "../src/agent/routes";
import { createTurnLog, type HookDeps } from "../src/hooks";
import type { HostEvent } from "../src/protocol";
import { Router } from "../src/router";
import type { PageClient } from "../src/server";
import { HostState } from "../src/state";
import { fakeContext, fakeLab } from "./fakeLab";
import { fakeSdk, initMessage, resultMessage, type FakeQuery } from "./fakeSdk";
import { cleanup, rejectsWith, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const CHECKOUT = "/repo";
const KEY_ENV = { ANTHROPIC_API_KEY: "sk-test", PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth", CLAUDECODE: "1" };
const dirs: string[] = [];
afterEach(() => cleanup(...dirs.splice(0)));

function setup(options: { env?: Record<string, string>; sessions?: Parameters<typeof fakeSdk>[0]; dir?: string } = {}) {
  const dir = options.dir ?? tempDir("agent-");
  dirs.push(dir);
  const events: HostEvent[] = [];
  const hooks: HookDeps = { packet: () => "Workbench context · test", turns: createTurnLog() };
  const sdk = fakeSdk(options.sessions ?? []);
  const state = new HostState(dir);
  const agents = new AgentManager({
    checkout: () => CHECKOUT,
    state,
    emit: (event) => events.push(event),
    hooks: () => hooks,
    toolContext: () => fakeContext(fakeLab().port),
    env: options.env ?? KEY_ENV,
    origin: "http://127.0.0.1:4100",
    sdk,
  });
  const query = (index = 0): FakeQuery => {
    const made = sdk.queries[index];
    if (made === undefined) throw new Error("no query");
    return made;
  };
  return { agents, events, sdk, state, query, dir };
}

const ofType = <T extends HostEvent["type"]>(events: HostEvent[], type: T) =>
  events.filter((event): event is Extract<HostEvent, { type: T }> => event.type === type);

describe("the credential rule", () => {
  test("refuses an api-key session without ANTHROPIC_API_KEY and starts no SDK process", async () => {
    const { agents, sdk } = setup({ env: { PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth" } });
    expect(() => agents.start({ mode: "default", credential: "api-key" })).toThrow(NO_KEY_MESSAGE);
    await rejectsWith(agents.resume({ mode: "default", credential: "api-key" }, "s-1", false), "ANTHROPIC_API_KEY");
    expect(sdk.queries).toHaveLength(0);
  });

  test("stops an api-key session whose init reports apiKeySource none", async () => {
    const { agents, query } = setup();
    const { session } = agents.start({ mode: "default", credential: "api-key" });
    query().push(initMessage("s-1", "none"));
    await until(() => agents.get(session).info().state === "error");
    expect(agents.get(session).info().error).toContain("claude.ai login");
    expect(query().calls).toContain("close");
  });

  test("a subscription session (the default) runs on apiKeySource none", async () => {
    const { agents, query } = setup();
    const { session } = agents.start({ mode: "default" });
    query().push(initMessage("s-1", "none"));
    await until(() => agents.get(session).info().state === "idle");
    expect(agents.get(session).info()).toMatchObject({ credential: "subscription", keyFrom: null });
    expect(query().calls).not.toContain("close");
  });
});

describe("the options of a session", () => {
  test("ask mode: explicit mode, preset prompt, strict MCP, only the workbench tools allowed, clean env", () => {
    const { agents, query } = setup();
    agents.start({ mode: "default", model: "claude-haiku-5-5", effort: "low" });
    const options = query().options;
    expect(options.permissionMode).toBe("default");
    expect(options.cwd).toBe(CHECKOUT);
    expect(options.allowedTools).toEqual(["mcp__workbench__*"]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settingSources).toBeUndefined();
    expect(options.enableFileCheckpointing).toBe(false);
    expect(options.includePartialMessages).toBe(true);
    expect(options.allowDangerouslySkipPermissions).toBe(false);
    expect(options.maxBudgetUsd).toBeUndefined();
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["workbench"]);
    expect(options.mcpServers?.workbench?.type).toBe("sdk");
    const prompt = options.systemPrompt as { type: string; preset: string; append: string };
    expect(prompt.type).toBe("preset");
    expect(prompt.preset).toBe("claude_code");
    expect(prompt.append).toContain("mcp__workbench__lab_frame");
    // The labs commands go through workbench_run, so the owner sees them in the Runs tab.
    expect(prompt.append).toContain("workbench_run, not with Bash");
    // The default credential is the subscription: no key variable reaches the SDK.
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(options.env?.CLAUDECODE).toBeUndefined();
    expect(options.env?.SCENITY_WORKBENCH_CHAT).toBe("1");
    expect(options.model).toBe("claude-haiku-5-5");
    expect(options.effort).toBe("low");
    expect(Object.keys(options.hooks ?? {}).sort()).toEqual(
      ["Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  test("all mode: bypass with a budget and a turn limit", () => {
    const { agents, query } = setup();
    agents.start({ mode: "bypassPermissions" });
    const { options } = query();
    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.maxBudgetUsd).toBe(5);
    expect(options.maxTurns).toBe(200);
  });
});

describe("a session", () => {
  test("takes many prompts on one query and reports init, messages and cost", async () => {
    const { agents, events, query, state, sdk } = setup();
    const { session } = agents.start({ mode: "default" });
    query().push(initMessage("s-1"));
    await until(() => agents.get(session).info().state === "idle");
    agents.get(session).prompt("first");
    agents.get(session).prompt("second");
    await until(() => query().prompts.length === 2);
    expect(query().prompts).toEqual(["first", "second"]);
    expect(sdk.queries).toHaveLength(1);
    query().push({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    });
    query().push({ type: "stream_event", event: { type: "message_start" } });
    query().push(resultMessage("s-1", 0.0123));
    await until(() => agents.get(session).info().results === 1);
    const info = agents.get(session).info();
    expect(info).toMatchObject({
      sdkSessionId: "s-1",
      apiKeySource: "ANTHROPIC_API_KEY",
      costUsd: 0.0123,
      state: "idle",
    });
    expect(info.modelUsage["claude-haiku-5-5"]?.outputTokens).toBe(5);
    expect(state.sessions(CHECKOUT)).toEqual(["s-1"]);
    const messages = ofType(events, "agent.message").map((event) => event.message as { type: string });
    expect(messages.map((message) => message.type)).toEqual(["system", "user", "user", "stream_event", "result"]);
    expect(messages[1]).toEqual({
      type: "user",
      workbenchPrompt: true,
      message: { role: "user", content: "first" },
    } as never);
    expect(agents.live()[0]?.messages).toHaveLength(4);
    await until(() => agents.get(session).info().models.length === 1);
    expect(await agents.get(session).contextUsage()).toEqual({ totalTokens: 1200, maxTokens: 200000, percentage: 0.6 });
  });

  test("sends model, effort and mode changes; refuses all without a budget", async () => {
    const { agents, query } = setup();
    const session = agents.get(agents.start({ mode: "default" }).session);
    await session.setModel("claude-haiku-5-5");
    await session.setEffort("high");
    await session.setMode("acceptEdits");
    await rejectsWith(session.setMode("bypassPermissions"), "needs a budget");
    expect(query().calls).toEqual([
      "setModel claude-haiku-5-5",
      'applyFlagSettings {"effortLevel":"high"}',
      "setPermissionMode acceptEdits",
    ]);
    expect(session.info()).toMatchObject({ mode: "acceptEdits", effort: "high" });
  });

  test("reports a loop error as a session error and resumes by SDK session ID", async () => {
    const info = { sessionId: "s-1", summary: "Fix the hat", lastModified: 2 };
    const { agents, query, sdk } = setup({ sessions: [info] });
    const { session } = agents.start({ mode: "default" });
    query().push(initMessage("s-1"));
    query().fail("Claude Code returned an error result: max turns");
    await until(() => agents.get(session).info().state === "error");
    expect(agents.get(session).info().error).toContain("error result");
    expect(() => agents.get(session).prompt("again")).toThrow("Resume it");
    const resumed = await agents.resume({ mode: "default" }, "s-1", false);
    expect(sdk.queries).toHaveLength(2);
    expect(query(1).options.resume).toBe("s-1");
    expect(resumed.info.sdkSessionId).toBe("s-1");
    expect(() => agents.get(session)).toThrow("No chat session");
  });

  test("forks a session for a second try and refuses an unknown session", async () => {
    const { agents, query, sdk } = setup({ sessions: [{ sessionId: "s-1", summary: "x", lastModified: 1 }] });
    const forked = await agents.resume({ mode: "acceptEdits" }, "s-1", true);
    expect(sdk.forks).toEqual(["s-1"]);
    expect(query().options.resume).toBe("s-1-fork");
    expect(forked.info.forkOf).toBe("s-1");
    await rejectsWith(agents.resume({ mode: "default" }, "s-9", false), "No session s-9");
  });

  test("resumes after a host restart from the state folder and lists the sessions with their cost", async () => {
    const first = setup({ sessions: [{ sessionId: "s-1", summary: "Fix", firstPrompt: "fix it", lastModified: 5 }] });
    first.agents.start({ mode: "default" });
    first.query().push(initMessage("s-1"));
    first.query().push(resultMessage("s-1", 0.02));
    await until(() => first.agents.live()[0]?.info.results === 1);
    await first.agents.closeAll();
    const second = setup({
      dir: first.dir,
      sessions: [{ sessionId: "s-1", summary: "Fix", firstPrompt: "fix it", lastModified: 5 }],
    });
    const list = await second.agents.sessions();
    expect(list).toEqual([
      {
        sessionId: "s-1",
        title: "Fix",
        firstPrompt: "fix it",
        lastModified: 5,
        createdAt: null,
        gitBranch: null,
        costUsd: 0.02,
        workbench: true,
        live: null,
        // The kept options of the session, with the model of the init.
        options: { mode: "default", credential: "subscription", model: "claude-haiku-5-5" },
        kept: true,
      },
    ]);
    const { session } = await second.agents.resume({ mode: "default" }, "s-1", false);
    expect(second.query().options.resume).toBe("s-1");
    expect((await second.agents.sessions())[0]?.live).toBe(session);
  });
});

describe("approvals and questions", () => {
  async function ask(tool: string, input: Record<string, unknown>, suggestions: unknown[] = []) {
    const made = setup();
    const { session } = made.agents.start({ mode: "default" });
    const canUseTool = made.query().options.canUseTool;
    if (canUseTool === undefined) throw new Error("no canUseTool");
    const controller = new AbortController();
    const pending = canUseTool(tool, input, {
      signal: controller.signal,
      suggestions: suggestions as never,
      decisionReason: "Edits need an approval",
      toolUseID: "tu-1",
      requestId: "rq-1",
    });
    await until(() => ofType(made.events, "agent.ask").length === 1);
    const event = ofType(made.events, "agent.ask")[0];
    if (event === undefined) throw new Error("no ask");
    return { ...made, session, pending, event, controller };
  }

  test("an Edit asks, notifies and runs on Allow with its input", async () => {
    const { agents, session, pending, event, events } = await ask("Edit", {
      file_path: "/repo/a.ts",
      old_string: "a",
      new_string: "b",
    });
    expect(event).toMatchObject({ kind: "tool", tool: "Edit", reason: "Edits need an approval", canRemember: false });
    expect(agents.get(session).info().state).toBe("waiting");
    expect(ofType(events, "agent.notify")[0]).toMatchObject({ kind: "permission_prompt", session });
    agents.get(session).answer(event.ask, { behavior: "allow", scope: "once" });
    expect(await pending).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" },
    });
    expect(ofType(events, "agent.askDone")).toHaveLength(1);
    expect(agents.get(session).asks()).toEqual([]);
  });

  test("a Deny gives the reason to Claude", async () => {
    const { agents, session, pending, event } = await ask("Write", { file_path: "/repo/x.ts", content: "x" });
    agents.get(session).answer(event.ask, { behavior: "deny", message: "Not this file." });
    expect(await pending).toEqual({ behavior: "deny", message: "Not this file." });
  });

  test("Allow for the session returns the suggestions with the destination session", async () => {
    const rule = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "bun test" }],
      behavior: "allow",
      destination: "localSettings",
    };
    const { agents, session, pending, event } = await ask("Bash", { command: "bun test" }, [rule]);
    expect(event.canRemember).toBe(true);
    agents.get(session).answer(event.ask, { behavior: "allow", scope: "session" });
    expect(await pending).toEqual({
      behavior: "allow",
      updatedInput: { command: "bun test" },
      updatedPermissions: [{ ...rule, destination: "session" }] as never,
    });
  });

  test("AskUserQuestion gets a question card and returns the answers", async () => {
    const questions = [
      { question: "Which hand?", header: "Hand", options: [{ label: "Left" }, { label: "Right" }], multiSelect: false },
    ];
    const { agents, session, pending, event, events } = await ask("AskUserQuestion", { questions });
    expect(event.kind).toBe("question");
    expect(ofType(events, "agent.notify")[0]?.kind).toBe("question");
    expect(() => agents.get(session).answer(event.ask, { behavior: "allow", scope: "once" })).toThrow(
      "needs an answer",
    );
    agents.get(session).answer(event.ask, { behavior: "answer", answers: { "Which hand?": "Left" } });
    expect(await pending).toEqual({
      behavior: "allow",
      updatedInput: { questions, answers: { "Which hand?": "Left" } },
    });
  });

  test("interrupt stops the turn and denies the open approval", async () => {
    const { agents, session, pending, query } = await ask("Edit", { file_path: "/repo/a.ts" });
    await agents.get(session).interrupt();
    expect(query().calls).toContain("interrupt");
    expect(await pending).toMatchObject({ behavior: "deny" });
    expect(agents.get(session).asks()).toEqual([]);
  });

  test("an abort of the SDK denies the open approval", async () => {
    const { pending, controller } = await ask("Edit", { file_path: "/repo/a.ts" });
    controller.abort();
    expect(await pending).toEqual({ behavior: "deny", message: "The turn stopped." });
  });
});

describe("the routes", () => {
  const client = {} as PageClient;
  test("agent.start api-key without a key answers with the refusal; with a key it starts", async () => {
    const without = setup({ env: { PATH: "/usr/bin" } });
    const router = new Router();
    addAgentHandlers(router, without.agents);
    const refused = await router.dispatch(
      JSON.stringify({ id: 1, type: "agent.start", mode: "default", credential: "api-key" }),
      client,
    );
    expect(refused).toEqual({ id: 1, ok: false, error: NO_KEY_MESSAGE });

    const made = setup();
    const routes = new Router();
    addAgentHandlers(routes, made.agents);
    const started = await routes.dispatch(JSON.stringify({ id: 2, type: "agent.start", mode: "acceptEdits" }), client);
    expect(started).toMatchObject({ id: 2, ok: true, result: { session: "chat-1" } });
    const bad = await routes.dispatch(JSON.stringify({ id: 3, type: "agent.start", mode: "auto" }), client);
    expect(bad).toMatchObject({ ok: false });
    const prompt = await routes.dispatch(
      JSON.stringify({ id: 4, type: "agent.prompt", session: "chat-1", text: "hi" }),
      client,
    );
    expect(prompt).toEqual({ id: 4, ok: true, result: null });
    const badAnswer = await routes.dispatch(
      JSON.stringify({ id: 5, type: "agent.answer", session: "chat-1", ask: "ask-1", decision: { behavior: "maybe" } }),
      client,
    );
    expect(badAnswer).toMatchObject({ ok: false });
    expect(JSON.stringify(badAnswer)).toContain("decision");
    const live = await routes.dispatch(JSON.stringify({ id: 6, type: "agent.live" }), client);
    expect(live).toMatchObject({
      ok: true,
      result: { sessions: [{ info: { session: "chat-1", mode: "acceptEdits" } }] },
    });
  });
});
