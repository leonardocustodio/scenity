// SPDX-License-Identifier: Apache-2.0
// The cost and the limits of the agent sessions: the defaults of an Auto session. A budget, a count of turns and the
// minutes of a turn stop a session and tell why. Also the tokens of a session and the ledger of the day.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptDriver, type ScriptStep } from "../src/agents/driver";
import { AUTO_DEFAULTS, nextLimits, turnRefusal, UsageLedger } from "../src/agents/limits";
import type { AgentItem } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionsOf(steps: readonly ScriptStep[], ledger?: UsageLedger) {
  return new AgentSessions({
    driver: scriptDriver({ turns: [steps] }),
    hub: new BridgeHub(),
    dirOf: () => null,
    emit: () => undefined,
    ...(ledger === undefined ? {} : { ledger }),
  });
}

async function idle(sessions: AgentSessions): Promise<readonly AgentItem[]> {
  for (let i = 0; i < 400; i += 1) {
    if (sessions.list()[0]?.running === false) return sessions.list()[0]?.items ?? [];
    await Bun.sleep(5);
  }
  throw new Error("the turn did not end");
}

const errorText = (items: readonly AgentItem[]): string => {
  const found = items.find((item) => item.kind === "error");
  return found?.kind === "error" ? found.text : "";
};

describe("the cost and the limits", () => {
  test("an Auto session gets the default limits; a bad limit or no budget is refused", () => {
    const none = { budgetUsd: null, maxTurns: null, maxMinutes: null };
    expect(nextLimits(none, {}, true, undefined)).toEqual(AUTO_DEFAULTS);
    expect(nextLimits(none, {}, true, 2)).toMatchObject({ budgetUsd: 2 });
    expect(nextLimits(none, { maxTurns: 3 }, false, undefined)).toEqual({
      budgetUsd: null,
      maxTurns: 3,
      maxMinutes: null,
    });
    expect(() => nextLimits(none, { maxMinutes: -1 }, false, undefined)).toThrow("A limit is 0 or more.");
    expect(() => nextLimits(none, { budgetUsd: 0 }, true, undefined)).toThrow("An Auto session needs a budget.");
    expect(turnRefusal({ budgetUsd: null, maxTurns: 2, maxMinutes: null, costUsd: 0 }, 3)).toContain("its 2 turns");
  });

  test("a session keeps its tokens and the ledger keeps the use of the day", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-usage-"));
    dirs.push(dir);
    const file = join(dir, "agent-usage.json");
    const sessions = sessionsOf([{ cost: 0.25, tokens: 1200 }], new UsageLedger(file));
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "go");
    await idle(sessions);
    expect(sessions.list()[0]).toMatchObject({ costUsd: 0.25, tokens: 1200 });
    expect(sessions.today()).toEqual({ costUsd: 0.25, tokens: 1200 });
    expect(new UsageLedger(file).today()).toEqual({ costUsd: 0.25, tokens: 1200 });
    expect(readFileSync(file, "utf8")).toContain("scenity.agent-usage/1");
  });

  test("the count of turns and the minutes of a turn stop a session and say why", async () => {
    const counted = sessionsOf([{ say: "one" }]);
    const session = counted.create("showroom", { maxTurns: 1 });
    counted.prompt(session.id, "first");
    await idle(counted);
    expect(() => counted.prompt(session.id, "second")).toThrow("its 1 turns");
    const slow = sessionsOf([{ wait: 5000 }, { say: "late" }]);
    const timed = slow.create("showroom", { maxMinutes: 0.001 });
    slow.prompt(timed.id, "wait");
    const items = await idle(slow);
    expect(errorText(items)).toContain("minutes");
    expect(items.some((item) => item.kind === "text")).toBe(false);
  });
});
