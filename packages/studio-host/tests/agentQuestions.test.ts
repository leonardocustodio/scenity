// SPDX-License-Identifier: Apache-2.0
// The questions of an agent: a question with 3 options waits for the person (the session waits). The answer returns
// to the agent, and a stop ends a question with no answer.
import { describe, expect, test } from "bun:test";
import { scriptDriver } from "../src/agents/driver";
import type { AgentItem } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const ASK = { tool: "ask_person", input: { question: "Which light?", options: ["Warm", "Cool", "Neutral"] } };

function sessionsOf() {
  return new AgentSessions({
    driver: scriptDriver({ turns: [[ASK, { say: "Thanks." }]] }),
    hub: new BridgeHub(),
    dirOf: () => null,
    emit: () => undefined,
  });
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(5);
  }
  throw new Error("timed out");
}

const items = (sessions: AgentSessions): readonly AgentItem[] => sessions.list()[0]?.items ?? [];
const card = (sessions: AgentSessions) => {
  const found = items(sessions).find((item) => item.kind === "question");
  return found?.kind === "question" ? found : undefined;
};

describe("the questions of an agent", () => {
  test("a question with 3 options gets its answer from the person", async () => {
    const sessions = sessionsOf();
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "light it");
    const question = await until(() => card(sessions));
    expect(question).toMatchObject({ text: "Which light?", options: ["Warm", "Cool", "Neutral"], answer: null });
    expect(sessions.list()[0]?.waiting).toBe(true);
    expect(() => sessions.answerQuestion(session.id, "q999", "Warm")).toThrow("No question q999 waits.");
    sessions.answerQuestion(session.id, question.question, "Cool");
    await until(() => (sessions.list()[0]?.running === false ? true : undefined));
    expect(card(sessions)?.answer).toBe("Cool");
    const tool = items(sessions).find((item) => item.kind === "tool");
    expect(tool?.kind === "tool" ? tool.result : "").toBe("The person answered: Cool");
    expect(sessions.list()[0]?.waiting).toBe(false);
  });

  test("a stop ends a question with no answer", async () => {
    const sessions = sessionsOf();
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "light it");
    await until(() => card(sessions));
    sessions.stop(session.id);
    await until(() => (sessions.list()[0]?.running === false ? true : undefined));
    const tool = items(sessions).find((item) => item.kind === "tool");
    expect(tool?.kind === "tool" ? tool.result : "").toContain("did not answer");
  });
});
