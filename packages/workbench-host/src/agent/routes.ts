// SPDX-License-Identifier: Apache-2.0
/**
 * The routes of the `agent.*` requests of the chat mode.
 */
import { isAgentEffort, isAgentMode } from "../agentProtocol";
import { isRecord, requestRefusal, type AgentDecision } from "../protocol";
import { needString, type Router } from "../router";
import { resumeOverrides, startParams, type AgentManager } from "./manager";

/** Check the decision of an `agent.answer`. */
export function decisionOf(value: unknown): AgentDecision {
  if (!isRecord(value)) throw new Error('The parameter "decision" must be an object.');
  if (value.behavior === "allow" && (value.scope === "once" || value.scope === "session")) {
    return { behavior: "allow", scope: value.scope };
  }
  if (value.behavior === "deny" && typeof value.message === "string")
    return { behavior: "deny", message: value.message };
  if (value.behavior === "answer" && isRecord(value.answers)) {
    const answers = Object.entries(value.answers);
    if (answers.every(([, label]) => typeof label === "string")) {
      return { behavior: "answer", answers: Object.fromEntries(answers) as Record<string, string> };
    }
  }
  throw new Error('The parameter "decision" is not an allow, a deny or an answer.');
}

/** Add the handlers of the chat mode to the router. */
export function addAgentHandlers(router: Router, agents: AgentManager): void {
  router
    .on("agent.start", (params) => agents.start(startParams(params)))
    .on("agent.resume", (params, client) => {
      const overrides = resumeOverrides(params);
      const sessionId = needString(params, "sessionId");
      // A resume keeps the mode of the session. The role of the page must also allow that mode.
      const refusal = requestRefusal(client.role, "agent.resume", { mode: agents.resumeMode(overrides, sessionId) });
      if (refusal !== null) throw new Error(refusal);
      return agents.resume(overrides, sessionId, params.fork === true);
    })
    .on("agent.prompt", (params) => {
      agents.get(needString(params, "session")).prompt(needString(params, "text"));
      return null;
    })
    .on("agent.interrupt", async (params) => {
      await agents.get(needString(params, "session")).interrupt();
      return null;
    })
    .on("agent.answer", (params) => {
      agents.get(needString(params, "session")).answer(needString(params, "ask"), decisionOf(params.decision));
      return null;
    })
    .on("agent.setMode", async (params) => {
      if (!isAgentMode(params.mode)) throw new Error('The parameter "mode" is not a mode of the chat.');
      await agents.setMode(needString(params, "session"), params.mode);
      return null;
    })
    .on("agent.setModel", async (params) => {
      await agents.get(needString(params, "session")).setModel(needString(params, "model"));
      return null;
    })
    .on("agent.setEffort", async (params) => {
      if (!isAgentEffort(params.effort)) throw new Error('The parameter "effort" is not an effort level.');
      await agents.get(needString(params, "session")).setEffort(params.effort);
      return null;
    })
    .on("agent.close", async (params) => {
      await agents.close(needString(params, "session"));
      return null;
    })
    .on("agent.live", () => ({ sessions: agents.live(), credential: agents.credential() }))
    .on("agent.sessions", async (params) => ({
      sessions: await agents.sessions(typeof params.limit === "number" ? params.limit : undefined),
    }))
    .on("agent.context", (params) => agents.get(needString(params, "session")).contextUsage());
}
