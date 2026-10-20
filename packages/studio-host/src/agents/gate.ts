// SPDX-License-Identifier: Apache-2.0
/**
 * The gate of the actions of an agent turn. The value of the kind of an action (permissions.ts) allows it or denies it.
 * Or the value puts an approval card in the transcript and waits for the person (approvals.ts). An answer "for this
 * session" allows the kind for the remaining part of the session. But a file that always asks continues to ask.
 */
import type { ApprovalDecision, ApprovalRequest, Approvals } from "./approvals";
import {
  filePermission,
  permissionOf,
  READ_ONLY_JOBS,
  type ActionKind,
  type KindValues,
  type Permission,
} from "./permissions";
import type { AgentItem, AgentMode, AgentSessionInfo } from "./protocol";

/** An action that asks the gate: the request of a card, and the path of a file write or the job of a run. */
export interface GateRequest extends ApprovalRequest {
  readonly path?: string;
  readonly job?: string;
}

/** The outcome of the gate: allowed, or the reason of the refusal. */
export type GateOutcome = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** What the gate reads of a session. */
export interface GateSession {
  readonly id: string;
  readonly mode: AgentMode;
  /** The values per kind of the person and of the project. */
  readonly values: readonly KindValues[];
  /** The kinds that the person allowed for the rest of the session. */
  readonly allowed: Set<ActionKind>;
  /** Put an approval card in the transcript. The result changes it to the decision. */
  card(approval: string, request: ApprovalRequest): (decision: ApprovalDecision) => void;
}

/** The value of an action in a session. */
export function actionPermission(session: Pick<GateSession, "mode" | "values">, request: GateRequest): Permission {
  let value = permissionOf(session.mode, request.kind, ...session.values);
  // Ask mode runs the jobs that only read, unless the person denies the runs.
  const denied = session.values.some((values) => values.runs === "deny");
  if (request.kind === "runs" && session.mode === "ask" && request.job !== undefined && !denied) {
    if (READ_ONLY_JOBS.has(request.job)) value = "allow";
  }
  if (request.kind === "files" && request.path !== undefined) value = filePermission(request.path, value);
  return value;
}

/** Ask the gate for an action of a session. An "ask" waits for the person. */
export async function permit(session: GateSession, approvals: Approvals, request: GateRequest): Promise<GateOutcome> {
  const value = actionPermission(session, request);
  if (value === "allow") return { allowed: true };
  if (value === "deny") {
    return {
      allowed: false,
      reason: `The ${session.mode} mode does not allow ${request.kind} actions (${request.title}).`,
    };
  }
  const always = request.kind === "files" && filePermission(request.path ?? "", "allow") === "ask";
  if (session.allowed.has(request.kind) && !always) return { allowed: true };
  const { id, decision } = approvals.open(session.id);
  const done = session.card(id, request);
  const answer = await decision;
  done(answer);
  if (answer === "session") session.allowed.add(request.kind);
  return answer === "deny" ? { allowed: false, reason: `The person denied it (${request.title}).` } : { allowed: true };
}

/** What the gate of a session reads (sessions.ts). */
export interface SessionGateParts {
  readonly info: AgentSessionInfo;
  readonly allowed: Set<ActionKind>;
  /** The decision on the current plan of the turn, or null. */
  readonly plan: "approved" | "denied" | null;
  readonly values: readonly KindValues[];
  nextId(): number;
  item(item: AgentItem): void;
  waiting(on: boolean): void;
}

/**
 * The gate of an action of a session. With "Plan first", an edit, a write or a run of a turn needs the approved plan
 * of the turn. Then the gate uses the value of its kind, with an approval card in the transcript for "ask".
 */
export function sessionPermit(
  parts: SessionGateParts,
  approvals: Approvals,
  request: GateRequest,
): Promise<GateOutcome> {
  const { info } = parts;
  if (info.planFirst && request.kind !== "network" && parts.plan !== "approved") {
    const reason =
      parts.plan === "denied"
        ? "The person denied the plan of this turn: make no change."
        : "Plan first: call plan_propose and wait for the approval of the person.";
    return Promise.resolve({ allowed: false, reason });
  }
  const gate: GateSession = {
    id: info.id,
    mode: info.mode,
    values: parts.values,
    allowed: parts.allowed,
    card: (approval, card) => {
      const base = {
        id: parts.nextId(),
        kind: "approval" as const,
        approval,
        action: card.kind,
        title: card.title,
        detail: card.detail,
      };
      parts.item({ ...base, decision: null });
      parts.waiting(true);
      return (decision) => {
        parts.item({ ...base, decision });
        parts.waiting(false);
      };
    },
  };
  return permit(gate, approvals, request);
}
