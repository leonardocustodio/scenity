// SPDX-License-Identifier: Apache-2.0
/**
 * The approvals and the questions of a chat session. The SDK calls `canUseTool` before it runs a tool that the mode
 * does not allow. The broker sends an `agent.ask` event to the page and waits for `agent.answer`. `AskUserQuestion`
 * comes through the same callback and gets a question card. Its answer returns as `updatedInput: { questions, answers }`.
 *
 * - Allow: the tool runs with its input. Allow for the session: the SDK also gets the rules of its suggestions, with
 *   the destination "session", so nothing goes into a settings file of the checkout.
 * - Deny: the reason of the owner reaches Claude as the tool result; the tool does not run.
 * - An interrupt aborts the wait: the call is denied and the page removes the card (`agent.askDone`).
 */
import type { AgentAsk } from "../agentProtocol";
import type { AgentDecision, HostEvent } from "../protocol";
import { isRecord } from "../protocol";
import { cutText } from "./messages";
import type { CanUseTool, PermissionResult, PermissionUpdate } from "./sdk";

/** The tool of the questions of Claude. */
export const QUESTION_TOOL = "AskUserQuestion";
/** The longest text of an input field in an `agent.ask` event (an approval card shows a diff of it). */
const ASK_TEXT_MAX = 200_000;

export interface AskBrokerDeps {
  /** The host ID of the session. */
  readonly session: string;
  emit(event: HostEvent): void;
  /** Called when the count of open asks changes (the session state "waiting"). */
  onCount?(count: number): void;
}

interface Open {
  readonly info: AgentAsk;
  readonly input: Record<string, unknown>;
  readonly suggestions: readonly PermissionUpdate[];
  readonly resolve: (result: PermissionResult) => void;
}

/** Give a copy of the input with each text cut to the limit of an `agent.ask` event. */
function askInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? cutText(value, ASK_TEXT_MAX) : value,
    ]),
  );
}

/** The rules of "Allow for the session": the suggestions of the SDK with the destination "session". */
export function sessionRules(suggestions: readonly PermissionUpdate[]): PermissionUpdate[] {
  return suggestions.map((rule) => ("destination" in rule ? { ...rule, destination: "session" } : rule));
}

/** The answer to the SDK for a decision of the owner. Throws for a decision that does not fit the kind. */
export function permissionResult(
  open: Pick<Open, "info" | "input" | "suggestions">,
  decision: AgentDecision,
): PermissionResult {
  if (decision.behavior === "deny") {
    return { behavior: "deny", message: decision.message.trim() === "" ? "The owner denied this." : decision.message };
  }
  if (open.info.kind === "question") {
    if (decision.behavior !== "answer") throw new Error("A question needs an answer.");
    return { behavior: "allow", updatedInput: { ...open.input, answers: { ...decision.answers } } };
  }
  if (decision.behavior !== "allow") throw new Error("An approval needs allow or deny.");
  if (decision.scope === "session" && open.suggestions.length > 0) {
    return { behavior: "allow", updatedInput: open.input, updatedPermissions: sessionRules(open.suggestions) };
  }
  return { behavior: "allow", updatedInput: open.input };
}

export class AskBroker {
  readonly #deps: AskBrokerDeps;
  readonly #open = new Map<string, Open>();
  #next = 1;

  constructor(deps: AskBrokerDeps) {
    this.#deps = deps;
  }

  /** The asks that wait for the owner. */
  pending(): AgentAsk[] {
    return [...this.#open.values()].map((open) => open.info);
  }

  /** The `canUseTool` callback of the session. */
  readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const ask = `ask-${String(this.#next++)}`;
      const info: AgentAsk = {
        session: this.#deps.session,
        ask,
        kind: toolName === QUESTION_TOOL ? "question" : "tool",
        tool: toolName,
        input: askInput(input),
        reason: options.decisionReason ?? null,
        title: options.title ?? null,
        canRemember: (options.suggestions?.length ?? 0) > 0,
      };
      const record = isRecord(input) ? input : {};
      this.#open.set(ask, { info, input: record, suggestions: options.suggestions ?? [], resolve });
      options.signal.addEventListener(
        "abort",
        () => this.#finish(ask, { behavior: "deny", message: "The turn stopped." }),
        {
          once: true,
        },
      );
      this.#deps.emit({ type: "agent.ask", ...info });
      this.#deps.onCount?.(this.#open.size);
    });

  /** Answer an ask. Throws for an unknown ask or a decision that does not fit. */
  answer(ask: string, decision: AgentDecision): void {
    const open = this.#open.get(ask);
    if (open === undefined) throw new Error(`No open approval or question "${ask}".`);
    this.#finish(ask, permissionResult(open, decision));
  }

  /** Deny every open ask (the session ends). */
  cancelAll(message: string): void {
    for (const ask of [...this.#open.keys()]) this.#finish(ask, { behavior: "deny", message });
  }

  #finish(ask: string, result: PermissionResult): void {
    const open = this.#open.get(ask);
    if (open === undefined) return;
    this.#open.delete(ask);
    open.resolve(result);
    this.#deps.emit({ type: "agent.askDone", session: this.#deps.session, ask });
    this.#deps.onCount?.(this.#open.size);
  }
}
