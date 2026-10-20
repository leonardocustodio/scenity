// SPDX-License-Identifier: Apache-2.0
/**
 * The real session check of the chat mode: one prompt to `claude-haiku-5-5`
 * with `maxTurns: 2` and `maxBudgetUsd: 0.25`, then a resume of the same SDK session by a second session manager on
 * the same state folder (the state of a host restart). It makes two model calls, so it runs only on request.
 * `--credential subscription` (the default) uses the claude.ai login of the machine; `--credential api-key` uses
 * `ANTHROPIC_API_KEY` of `<checkout>/.env` (mode 600) or of the environment, and the API bills the calls.
 * The 0.25 budget is below the cost of a first turn without a prompt cache (about 0.3 USD).
 * Thus the SDK stops after the answer of that turn with `error_max_budget_usd`.
 *
 *   bun packages/workbench-host/scripts/chat-check.ts [--checkout <abs path>] [--credential subscription|api-key]
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentManager } from "../src/agent/index";
import { isAgentCredential } from "../src/agentProtocol";
import type { AgentSession } from "../src/agent/session";
import { createTurnLog } from "../src/hooks";
import type { HostEvent } from "../src/protocol";
import { HostState } from "../src/state";
import { makeToolContext } from "../src/tools/context";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const credential = arg("--credential") ?? "subscription";
if (!isAgentCredential(credential)) throw new Error('"--credential" must be subscription or api-key.');
const LIMITS = { mode: "default", credential, model: "claude-haiku-5-5", maxTurns: 2, maxBudgetUsd: 0.25 } as const;
const checkout = arg("--checkout") ?? process.cwd();
const stateDir = mkdtempSync(join(tmpdir(), "workbench-chat-check-"));

function manager(events: HostEvent[]): AgentManager {
  const noFrame = { call: () => Promise.reject(new Error("No lab frame in this check.")) };
  return new AgentManager({
    checkout: () => checkout,
    state: new HostState(stateDir),
    emit: (event) => events.push(event),
    hooks: () => ({ packet: () => "Workbench context · chat check (no lab frame).", turns: createTurnLog() }),
    toolContext: () => makeToolContext({ surface: () => noFrame, checkout }),
  });
}

async function turn(session: AgentSession, prompt: string): Promise<void> {
  const before = session.info().results;
  session.prompt(prompt);
  const end = Date.now() + 90_000;
  while (session.info().results === before && session.info().state !== "error" && Date.now() < end) {
    await Bun.sleep(200);
  }
}

const first = manager([]);
const started = first.get(first.start(LIMITS).session);
await turn(started, "Answer with the one word: pong.");
const one = started.info();
await first.closeAll();
if (one.sdkSessionId === null) throw new Error(`No session: ${one.error ?? "no init"}`);

const second = manager([]);
const resumed = second.get((await second.resume(LIMITS, one.sdkSessionId, false)).session);
await turn(resumed, "Which word did you answer before? Answer with that word only.");
const two = resumed.info();
await second.closeAll();
const last = (session: AgentSession): unknown =>
  session
    .messages()
    .filter((item) => (item as { type?: string }).type === "result")
    .at(-1);
console.log(
  JSON.stringify(
    {
      checkout,
      credential: one.credential,
      keyFrom: one.keyFrom,
      first: {
        sessionId: one.sdkSessionId,
        apiKeySource: one.apiKeySource,
        version: one.claudeCodeVersion,
        cost: one.costUsd,
        result: last(started),
      },
      resumed: { sessionId: two.sdkSessionId, cost: two.costUsd, result: last(resumed) },
    },
    null,
    2,
  ),
);
