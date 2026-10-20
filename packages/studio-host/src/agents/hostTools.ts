// SPDX-License-Identifier: Apache-2.0
/**
 * The tools that the studio host runs itself in a turn: the plan tools (plans.ts)
 * and the question tool (questions.ts). The other tools go to the editor windows (toolCalls.ts).
 */
import type { ToolDef, ToolResult } from "@scenity/agent-tools";
import { PLAN_TOOLS, PLAN_TOOL_NAMES } from "./plans";
import { runPlanTool, type PlanToolParts } from "./planTools";
import { QUESTION_TOOLS, runQuestion, type Questions } from "./questions";

/** The listings of the host tools. */
export const HOST_TOOLS: readonly ToolDef[] = [...PLAN_TOOLS, ...QUESTION_TOOLS];
/** The names of the host tools. */
export const HOST_TOOL_NAMES: ReadonlySet<string> = new Set(HOST_TOOLS.map((tool) => tool.name));

/** What the host tools read of their session. */
export interface HostToolParts extends PlanToolParts {
  readonly questions: Questions;
}

/** Run a host tool of a turn. */
export function runHostTool(parts: HostToolParts, name: string, input: unknown): Promise<ToolResult> {
  return PLAN_TOOL_NAMES.has(name) ? runPlanTool(parts, name, input) : runQuestion(parts, input);
}
