// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the chat mode through a host with a fake Agent SDK: the
 * WebSocket requests, the refusal without a key, the in-process server and the hooks of the agent loop in the
 * options, the end of the sessions with the host, and a resume after a restart of the host.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_KEY_MESSAGE } from "../src/agent/credential";
import { OPTIONS_FILE } from "../src/agent/keptOptions";
import { startHost } from "../src/host";
import { fakeSdk, initMessage, resultMessage } from "./fakeSdk";
import { cleanup, FakePage, fakeCommand, makeRepo, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

describe("the chat mode in a host", () => {
  test(
    "refuses an api-key start without a key, runs a session with a key, and resumes it after a restart",
    async () => {
      const { parent, repo } = await makeRepo();
      const state = tempDir("chat-state");
      made.push(parent, state);
      const sessions = [{ sessionId: "s-1", summary: "Fix the hat", firstPrompt: "fix", lastModified: 9 }];

      const bare = await startHost({
        checkout: repo,
        stateDir: state,
        serverCommand: fakeCommand,
        watch: false,
        chat: { sdk: fakeSdk(), env: { PATH: "/usr/bin" } },
      });
      const barePage = await FakePage.open(bare.endpoint);
      expect(await barePage.request("agent.start", { mode: "default", credential: "api-key" })).toMatchObject({
        ok: false,
        error: NO_KEY_MESSAGE,
      });
      barePage.close();
      await bare.stop();

      const sdk = fakeSdk(sessions);
      const env = { ANTHROPIC_API_KEY: "sk-test", PATH: "/usr/bin" };
      const host = await startHost({
        checkout: repo,
        stateDir: state,
        serverCommand: fakeCommand,
        watch: false,
        chat: { sdk, env },
      });
      const page = await FakePage.open(host.endpoint);
      const { session } = (await page.call("agent.start", { mode: "default", credential: "api-key" })) as {
        session: string;
      };
      const query = sdk.queries[0];
      if (query === undefined) throw new Error("no query");
      expect(query.options.cwd).toBe(repo);
      expect(query.options.env?.ANTHROPIC_API_KEY).toBe("sk-test");
      expect(query.options.mcpServers?.workbench?.type).toBe("sdk");
      const promptHook = query.options.hooks?.UserPromptSubmit?.[0]?.hooks[0];
      const signal = new AbortController().signal;
      const hookAnswer = await promptHook?.(
        { hook_event_name: "UserPromptSubmit", session_id: "s-1", cwd: repo, prompt: "x" } as never,
        undefined,
        { signal },
      );
      expect(typeof hookAnswer).toBe("object");
      query.push(initMessage("s-1"));
      await page.waitEvent((event) => event.type === "agent.status" && event.info.sdkSessionId === "s-1");
      await page.call("agent.prompt", { session, text: "fix the hat" });
      await until(() => query.prompts.length === 1);
      query.push(resultMessage("s-1", 0.004));
      await page.waitEvent(
        (event) => event.type === "agent.message" && (event.message as { type: string }).type === "result",
      );
      page.close();
      await host.stop();
      expect(query.calls).toContain("close");

      const again = fakeSdk(sessions);
      const restarted = await startHost({
        checkout: repo,
        stateDir: state,
        serverCommand: fakeCommand,
        watch: false,
        chat: { sdk: again, env },
      });
      const second = await FakePage.open(restarted.endpoint);
      // The host remembers the credential choice of the checkout (never the key).
      expect(((await second.call("agent.live")) as { credential: string }).credential).toBe("api-key");
      const list = (await second.call("agent.sessions")) as {
        sessions: { sessionId: string; workbench: boolean; costUsd: number | null }[];
      };
      // The list gives the kept options of the session (the credential choice, never the key).
      expect(list.sessions).toMatchObject([
        {
          sessionId: "s-1",
          workbench: true,
          costUsd: 0.004,
          kept: true,
          options: { mode: "default", credential: "api-key", model: "claude-haiku-5-5" },
        },
      ]);
      expect(readFileSync(join(state, OPTIONS_FILE), "utf8")).not.toContain("sk-test");
      // A resume without options (the Sessions tab) runs on the kept options.
      const resumed = (await second.call("agent.resume", { sessionId: "s-1" })) as { session: string };
      expect(again.queries[0]?.options.resume).toBe("s-1");
      expect(again.queries[0]?.options.model).toBe("claude-haiku-5-5");
      expect(again.queries[0]?.options.env?.ANTHROPIC_API_KEY).toBe("sk-test");
      expect(((await second.call("agent.live")) as { sessions: unknown[] }).sessions).toHaveLength(1);
      await second.call("agent.close", { session: resumed.session });
      second.close();
      await restarted.stop();
    },
    ciWaitMs(30_000),
  );
});
