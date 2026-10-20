// SPDX-License-Identifier: Apache-2.0
/**
 * The plan tools of a turn (plans.ts). `plan_propose` puts the plan card in the transcript and waits for the person
 * (Approve, with the steps of an edit, or Deny). An approved plan goes to its file. `plan_step` and `plan_done` change
 * the card and the file.
 */
import type { ToolResult } from "@scenity/agent-tools";
import type { Approvals } from "./approvals";
import { doneOf, planOf, planPath, savePlan, stepOf, type Plan } from "./plans";
import type { AgentItem } from "./protocol";

/** What a plan tool reads of its session and of the host. */
export interface PlanToolParts {
  readonly session: string;
  readonly approvals: Approvals;
  /** The project folder, or null. */
  readonly dir: string | null;
  /** The current plan of the turn, and its change. */
  plan(): { readonly plan: Plan; readonly item: number; readonly approval: string } | null;
  setPlan(next: { readonly plan: Plan; readonly item: number; readonly approval: string }): void;
  nextId(): number;
  item(item: AgentItem): void;
  waiting(on: boolean): void;
  /** The steps of an edit of the person for an approval, or null. */
  edited(approval: string): readonly string[] | null;
}

const text = (lines: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: lines }],
  ...(isError ? { isError: true } : {}),
});

/** Show a plan and wait for the decision of the person. */
async function propose(parts: PlanToolParts, input: unknown): Promise<ToolResult> {
  const { id: approval, decision } = parts.approvals.open(parts.session);
  const made = planOf(input);
  if (typeof made === "string") return text(`plan_propose: ${made}`, true);
  const item = parts.nextId();
  const show = (plan: Plan): void => {
    parts.setPlan({ plan, item, approval });
    parts.item({ id: item, kind: "plan", approval, ...plan });
  };
  show(made);
  parts.waiting(true);
  const answer = await decision;
  parts.waiting(false);
  if (answer === "deny") {
    show({ ...made, decision: "denied" });
    return text("The person denied the plan. Make no change; ask what to do instead.");
  }
  const steps = parts.edited(approval) ?? made.steps.map((step) => step.text);
  const approved: Plan = {
    ...made,
    steps: steps.map((step) => ({ text: step, state: "todo" })),
    decision: "approved",
    path: parts.dir === null ? null : planPath(made),
  };
  show(approved);
  if (parts.dir !== null) savePlan(parts.dir, approved);
  const lines = approved.steps.map((step, at) => `${String(at)}. ${step.text}`);
  const saved = approved.path === null ? "" : ` It is saved in ${approved.path}.`;
  return text([`The person approved the plan (${String(lines.length)} steps).${saved}`, ...lines].join("\n"));
}

/** Run a plan tool of a turn. */
export async function runPlanTool(parts: PlanToolParts, name: string, input: unknown): Promise<ToolResult> {
  if (name === "plan_propose") return propose(parts, input);
  const now = parts.plan();
  if (now?.plan.decision !== "approved") return text(`${name}: no approved plan in this turn.`, true);
  const next = name === "plan_step" ? stepOf(now.plan, input) : doneOf(now.plan, input);
  if (typeof next === "string") return text(next, true);
  parts.setPlan({ ...now, plan: next });
  parts.item({ id: now.item, kind: "plan", approval: now.approval, ...next });
  if (parts.dir !== null) savePlan(parts.dir, next);
  return text(name === "plan_done" ? "The plan has its summary." : "The step is ticked.");
}
