// SPDX-License-Identifier: Apache-2.0
/**
 * Plan mode of the agent sessions. The agent writes a plan card (its steps, the files that it will change, the risks)
 * with the tool `plan_propose`. The person approves it (as it is or after an edit of the steps) or denies it. The host
 * saves an approved plan in `.scenity/plans/<date>-<slug>.md`. `plan_step` marks a step as done during the run, and
 * `plan_done` adds the summary at the end. The file gets each change. A session with "Plan first" makes no edit, write
 * or run in a turn before the person approves a plan of the turn. Thus a denied plan changes nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDef } from "@scenity/agent-tools";
import { z } from "zod";

/** The state of a step of a plan. */
export type PlanStepState = "todo" | "doing" | "done" | "skipped";

/** A plan of a turn. */
export interface Plan {
  readonly title: string;
  readonly steps: readonly { readonly text: string; readonly state: PlanStepState }[];
  readonly files: readonly string[];
  readonly risks: readonly string[];
  /** null while the plan waits, else the decision of the person. */
  readonly decision: "approved" | "denied" | null;
  readonly summary: string | null;
  /** The file of the plan in the project, after the approval. */
  readonly path: string | null;
}

const proposeInput = z.object({
  title: z.string().min(1).max(200).describe("The goal of the plan in a few words."),
  steps: z.array(z.string().min(1).max(300)).min(1).max(30).describe("The steps, in their order."),
  files: z.array(z.string().max(300)).max(50).optional().describe("The files and entities that the plan touches."),
  risks: z.array(z.string().max(300)).max(20).optional().describe("What can go wrong."),
});
const stepInput = z.object({
  index: z.number().int().min(0).describe("The step (0 is the first one)."),
  state: z.enum(["doing", "done", "skipped"]).describe("The new state of the step."),
});
const doneInput = z.object({ summary: z.string().min(1).max(2000).describe("What changed, in a few lines.") });

const host = (): never => {
  throw new Error("the studio host runs this tool");
};

/** The plan tools. The studio host runs them. The handlers here only give the listing. */
export const PLAN_TOOLS: readonly ToolDef[] = [
  defineTool({
    name: "plan_propose",
    description:
      "Show the person a plan (its steps, the files it touches, the risks) and wait for the decision: approved (with " +
      "the steps of the person) or denied. With 'Plan first' no edit runs before an approved plan.",
    input: proposeInput,
    alwaysLoad: true,
    handler: host,
  }),
  defineTool({
    name: "plan_step",
    description: "Tick a step of the approved plan: doing, done or skipped.",
    input: stepInput,
    alwaysLoad: false,
    handler: host,
  }),
  defineTool({
    name: "plan_done",
    description: "End the plan with a summary of what changed.",
    input: doneInput,
    alwaysLoad: false,
    handler: host,
  }),
];

/** The names of the plan tools. */
export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set(PLAN_TOOLS.map((tool) => tool.name));

/** A plan from the input of `plan_propose`, or the reason of a bad input. */
export function planOf(input: unknown): Plan | string {
  const parsed = proposeInput.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  const { title, steps, files = [], risks = [] } = parsed.data;
  return {
    title,
    steps: steps.map((text) => ({ text, state: "todo" })),
    files,
    risks,
    decision: null,
    summary: null,
    path: null,
  };
}

/** A plan after `plan_step`, or the reason of a bad input. */
export function stepOf(plan: Plan, input: unknown): Plan | string {
  const parsed = stepInput.safeParse(input);
  if (!parsed.success) return "plan_step: give the index and the state (doing, done or skipped).";
  const { index, state } = parsed.data;
  if (index >= plan.steps.length) return `plan_step: the plan has ${String(plan.steps.length)} steps.`;
  return { ...plan, steps: plan.steps.map((step, at) => (at === index ? { ...step, state } : step)) };
}

/** A plan after `plan_done`, or the reason of a bad input. */
export function doneOf(plan: Plan, input: unknown): Plan | string {
  const parsed = doneInput.safeParse(input);
  return parsed.success ? { ...plan, summary: parsed.data.summary } : "plan_done: give the summary.";
}

/** The Markdown of a plan file. */
export function planMarkdown(plan: Plan): string {
  const marks: Record<PlanStepState, string> = { todo: "[ ]", doing: "[~]", done: "[x]", skipped: "[-]" };
  const lines = [
    `# ${plan.title}`,
    "",
    "## Steps",
    "",
    ...plan.steps.map((step) => `- ${marks[step.state]} ${step.text}`),
  ];
  if (plan.files.length > 0) lines.push("", "## Files", "", ...plan.files.map((file) => `- ${file}`));
  if (plan.risks.length > 0) lines.push("", "## Risks", "", ...plan.risks.map((risk) => `- ${risk}`));
  if (plan.summary !== null) lines.push("", "## Summary", "", plan.summary);
  return `${lines.join("\n")}\n`;
}

/** The project path of the file of a plan: `.scenity/plans/<date>-<slug>.md`. */
export function planPath(plan: Pick<Plan, "title">, now = new Date()): string {
  const slug = plan.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `.scenity/plans/${now.toISOString().slice(0, 10)}-${slug === "" ? "plan" : slug}.md`;
}

/** Write the file of a plan in the project folder. */
export function savePlan(dir: string, plan: Plan): void {
  if (plan.path === null) return;
  mkdirSync(join(dir, ".scenity", "plans"), { recursive: true });
  writeFileSync(join(dir, plan.path), planMarkdown(plan));
}
