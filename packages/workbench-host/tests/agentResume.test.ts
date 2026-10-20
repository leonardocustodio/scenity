// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the kept options of the chat sessions against a fake Agent SDK. A resume and a fork use the last options
 * of the session, and the options of the request win. A session without kept options gets the defaults of the start
 * form. The key never goes into the kept options. No test starts Claude Code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentManager } from "../src/agent/index";
import type { AgentStartParams } from "../src/agentProtocol";
import { mergeParams, OPTIONS_FILE, OPTIONS_MAX, OptionsStore, parseKept } from "../src/agent/keptOptions";
import { addAgentHandlers } from "../src/agent/routes";
import { createTurnLog, type HookDeps } from "../src/hooks";
import { Router } from "../src/router";
import type { PageClient } from "../src/server";
import { HostState } from "../src/state";
import { fakeContext, fakeLab } from "./fakeLab";
import { fakeSdk, initMessage, type FakeQuery } from "./fakeSdk";
import { cleanup, rejectsWith, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const CHECKOUT = "/repo";
const KEY = "sk-ant-test-0123456789";
const ENV = { ANTHROPIC_API_KEY: KEY, PATH: "/usr/bin" };
const SESSIONS = [
  { sessionId: "s-1", summary: "Fix the hat", lastModified: 2 },
  { sessionId: "cli-1", summary: "A CLI session", lastModified: 1 },
];
const dirs: string[] = [];
afterEach(() => cleanup(...dirs.splice(0)));

function setup(dir = tempDir("agent-options-")) {
  dirs.push(dir);
  const hooks: HookDeps = { packet: () => "Workbench context · test", turns: createTurnLog() };
  const sdk = fakeSdk(SESSIONS);
  const state = new HostState(dir);
  const agents = new AgentManager({
    checkout: () => CHECKOUT,
    state,
    emit: () => undefined,
    hooks: () => hooks,
    toolContext: () => fakeContext(fakeLab().port),
    env: ENV,
    sdk,
  });
  const query = (index: number): FakeQuery => {
    const made = sdk.queries[index];
    if (made === undefined) throw new Error("no query");
    return made;
  };
  return { agents, sdk, state, query, dir };
}

/** Start a session on the API key with all options, change its model and effort, and end it. */
async function runFirst(made: ReturnType<typeof setup>): Promise<void> {
  const { session } = made.agents.start({
    mode: "acceptEdits",
    credential: "api-key",
    model: "claude-haiku-5-5",
    effort: "low",
    maxBudgetUsd: 0.25,
    maxTurns: 7,
  });
  made.query(0).push(initMessage("s-1"));
  await until(() => made.agents.get(session).info().state === "idle");
  await made.agents.get(session).setModel("claude-sonnet-5-5");
  await made.agents.get(session).setEffort("medium");
  await made.agents.closeAll();
}

describe("the kept options of a session", () => {
  test("a resume after a host restart keeps the model, effort, mode, credential, budget and turn limit", async () => {
    const first = setup();
    await runFirst(first);
    const second = setup(first.dir);
    await second.agents.resume({}, "s-1", false);
    const options = second.query(0).options;
    expect(options.resume).toBe("s-1");
    expect(options.model).toBe("claude-sonnet-5-5");
    expect(options.effort).toBe("medium");
    expect(options.permissionMode).toBe("acceptEdits");
    expect(options.maxBudgetUsd).toBe(0.25);
    expect(options.maxTurns).toBe(7);
    expect(options.env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(second.agents.live()[0]?.info).toMatchObject({ credential: "api-key", keyFrom: "environment" });
  });

  test("a fork keeps the options of its source, and the fork gets its own kept options", async () => {
    const first = setup();
    await runFirst(first);
    const forked = await first.agents.resume({}, "s-1", true);
    const options = first.query(1).options;
    expect(options.resume).toBe("s-1-fork");
    expect(options.model).toBe("claude-sonnet-5-5");
    expect(options.maxBudgetUsd).toBe(0.25);
    expect(forked.info.forkOf).toBe("s-1");
    expect(first.agents.resumeOptions("s-1-fork")).toMatchObject({ kept: true, options: { effort: "medium" } });
  });

  test("the options of the request win over the kept options", async () => {
    const first = setup();
    await runFirst(first);
    await first.agents.resume({ model: "claude-opus-5-5", credential: "subscription", maxBudgetUsd: 1 }, "s-1", true);
    const options = first.query(1).options;
    expect(options.model).toBe("claude-opus-5-5");
    expect(options.maxBudgetUsd).toBe(1);
    expect(options.effort).toBe("medium");
    expect(options.maxTurns).toBe(7);
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("a session without kept options gets the defaults of the start form, with the remembered credential", async () => {
    const made = setup();
    made.state.setChatCredential(CHECKOUT, "api-key");
    expect(made.agents.resumeOptions("cli-1")).toEqual({
      options: { mode: "default", credential: "api-key" },
      kept: false,
    });
    await made.agents.resume({}, "cli-1", false);
    const options = made.query(0).options;
    expect(options.permissionMode).toBe("default");
    expect(options.env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(options.model).toBeUndefined();
    const list = await made.agents.sessions();
    expect(list.find((entry) => entry.sessionId === "cli-1")).toMatchObject({ kept: true });
    await rejectsWith(made.agents.resume({}, "nope", false), "No session nope");
  });

  test("the key never goes into the kept options", async () => {
    const first = setup();
    await runFirst(first);
    const text = readFileSync(join(first.dir, OPTIONS_FILE), "utf8");
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({
      "s-1": {
        mode: "acceptEdits",
        credential: "api-key",
        model: "claude-sonnet-5-5",
        effort: "medium",
        maxBudgetUsd: 0.25,
        maxTurns: 7,
      },
    });
    // A hand-made entry with other fields loses them on read.
    writeFileSync(join(first.dir, OPTIONS_FILE), JSON.stringify({ x: { mode: "default", key: KEY, apiKey: KEY } }));
    expect(new OptionsStore(first.dir).get("x")).toEqual({ mode: "default" });
  });
});

describe("the parts of the kept options", () => {
  test("parseKept refuses a bad entry and mergeParams skips the absent overrides", () => {
    expect(parseKept({ mode: "nope" })).toBeNull();
    expect(parseKept({ mode: "default", effort: "huge", maxTurns: -1, credential: "token" })).toEqual({
      mode: "default",
    });
    const overrides = { model: undefined, effort: "low" } as unknown as Partial<AgentStartParams>;
    expect(mergeParams({ mode: "default", model: "a" }, overrides)).toEqual({
      mode: "default",
      model: "a",
      effort: "low",
    });
  });

  test("the store keeps the newest sessions only", () => {
    const dir = tempDir("agent-options-");
    dirs.push(dir);
    const store = new OptionsStore(dir);
    for (let index = 0; index <= OPTIONS_MAX; index += 1) store.set(`s-${String(index)}`, { mode: "default" });
    expect(store.get("s-0")).toBeNull();
    expect(store.get(`s-${String(OPTIONS_MAX)}`)).toEqual({ mode: "default" });
  });

  test("the route takes a resume without a mode and refuses a bad mode", async () => {
    const made = setup();
    const router = new Router();
    addAgentHandlers(router, made.agents);
    const client = { role: "admin" } as PageClient;
    const bad = await router.dispatch(
      JSON.stringify({ id: 1, type: "agent.resume", sessionId: "s-1", mode: "nope" }),
      client,
    );
    expect(bad).toMatchObject({ ok: false });
    const good = await router.dispatch(JSON.stringify({ id: 2, type: "agent.resume", sessionId: "s-1" }), client);
    expect(good).toMatchObject({ ok: true });
    expect(made.query(0).options.permissionMode).toBe("default");
  });
});
