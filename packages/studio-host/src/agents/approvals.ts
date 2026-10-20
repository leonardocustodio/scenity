// SPDX-License-Identifier: Apache-2.0
/**
 * The approvals of the agent sessions: an action with the value "ask" waits for the person. The transcript gets an
 * approval card with the action, its kind and its detail (a diff or a command line). The person answers Allow once,
 * Allow for this session (the kind needs no card again in the session) or Deny. A stop of the turn denies each card of
 * the turn that waits.
 */
import type { ActionKind } from "./permissions";

/** The answer of a person to an approval card. */
export type ApprovalDecision = "once" | "session" | "deny";
export const APPROVAL_DECISIONS: readonly ApprovalDecision[] = ["once", "session", "deny"];

/** An approval request. */
export interface ApprovalRequest {
  readonly kind: ActionKind;
  readonly title: string;
  /** The diff of a write or the command line of a run. */
  readonly detail: string;
}

interface Waiting {
  readonly session: string;
  readonly resolve: (decision: ApprovalDecision) => void;
}

/** The approval cards that wait, by ID. */
export class Approvals {
  readonly #waiting = new Map<string, Waiting>();
  #next = 1;

  /** Open a card. The result is its ID and the promise of the decision. */
  open(session: string): { id: string; decision: Promise<ApprovalDecision> } {
    const id = `a${String(this.#next++)}`;
    const decision = new Promise<ApprovalDecision>((resolve) => {
      this.#waiting.set(id, { session, resolve });
    });
    return { id, decision };
  }

  /** The answer of the person. False when no card of the session has the ID. */
  answer(session: string, id: string, decision: ApprovalDecision): boolean {
    const waiting = this.#waiting.get(id);
    if (waiting?.session !== session) return false;
    this.#waiting.delete(id);
    waiting.resolve(decision);
    return true;
  }

  /** Deny each card of a session that waits (a stop, a close). */
  denyAll(session: string): void {
    for (const [id, waiting] of this.#waiting) {
      if (waiting.session !== session) continue;
      this.#waiting.delete(id);
      waiting.resolve("deny");
    }
  }
}
