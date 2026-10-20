// SPDX-License-Identifier: Apache-2.0
/**
 * The driver of the agent sessions: the part that runs one turn of a session. The session service (sessions.ts) gives
 * the prompt, the tools and a signal. The driver gives the text of the agent and its cost. Each tool call goes through
 * `tools.run`, so the service records it in the transcript and applies the mode.
 *
 * Two drivers: the Claude driver (claude.ts, the Agent SDK) and the script driver of this file. The script driver
 * runs the steps of a JSON file (`SCENITY_AGENT_SCRIPT`), so a test runs a turn with real tools and no model.
 */
import { readFileSync } from "node:fs";
import type { ToolListing, ToolResult } from "@scenity/agent-tools";
import { contextPacket, type AgentChip } from "./context";
import type { GateOutcome, GateRequest } from "./gate";
import type { AgentSessionInfo } from "./protocol";

/** The tools of a turn. */
export interface TurnTools {
  readonly listings: readonly ToolListing[];
  /** Run a tool with the rules of the mode of the session. A refusal is a tool error. */
  run(name: string, input: unknown): Promise<ToolResult>;
}

/** The input of one turn. */
export interface TurnInput {
  readonly prompt: string;
  /** The chips of the prompt (the context packet and the pictures). */
  readonly context: readonly AgentChip[];
  /** The instructions of the project (AGENTS.md, CLAUDE.md, the skills), or "". */
  readonly instructions: string;
  readonly session: AgentSessionInfo;
  /** The folder of the project, or null. */
  readonly dir: string | null;
  readonly signal: AbortSignal;
  readonly tools: TurnTools;
  /** Add a text of the agent to the transcript. */
  say(text: string): void;
  /** Give the cost of the turn (USD), the share of the context window (0 to 1, or null) and its tokens. */
  usage(costUsd: number, contextShare: number | null, tokens?: number): void;
  /**
   * The files of the project for the turn. `snapshot` keeps a file before a write of the agent (a tool of the model
   * writes it next). `write` keeps it and writes it. Both give the path in the project. Both throw for a path out of
   * the project or a session with no project folder.
   */
  readonly files: { snapshot(path: string): string; write(path: string, text: string): Promise<string> };
  /** Ask the gate for an action of the model (a file write, a network call). An "ask" waits for the person. */
  permit(request: GateRequest): Promise<GateOutcome>;
}

/** A driver of the turns. */
export interface AgentDriver {
  /** The name that the panel shows ("claude" or "script"). */
  readonly name: string;
  turn(input: TurnInput): Promise<void>;
  /** A session closes: the driver deletes its state of the session. */
  close?(session: string): void;
  /** A session becomes a fork of another one: the next turn of `to` continues the conversation of `from`. */
  fork?(from: string, to: string): void;
}

/**
 * One step of a script: a text, a tool call, a file write, a wait (ms), a cost, or a choice on the instructions of the
 * project. A choice gives the `steps` when the `when` text is in the instructions, else the `otherwise` steps. Thus a
 * script can obey the instructions.
 */
export type ScriptStep =
  | { readonly say: string }
  | { readonly when: string; readonly steps: readonly ScriptStep[]; readonly otherwise?: readonly ScriptStep[] }
  | { readonly write: { readonly path: string; readonly text: string } }
  | { readonly tool: string; readonly input?: unknown }
  | { readonly wait: number }
  | { readonly cost: number; readonly context?: number; readonly tokens?: number };

/**
 * A script: the steps of each turn. The turns after the last use the last one. `prompts` gives the steps of a prompt
 * with that exact text in place of the next turn.
 */
export interface AgentScript {
  readonly turns: readonly (readonly ScriptStep[])[];
  readonly prompts?: Readonly<Record<string, readonly ScriptStep[]>>;
}

/** The wait of a step. A stop ends it immediately. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Run the steps of a script for a turn. */
async function runSteps(steps: readonly ScriptStep[], input: TurnInput): Promise<void> {
  for (const step of steps) {
    if (input.signal.aborted) return;
    if ("when" in step) {
      const follows = input.instructions.toLowerCase().includes(step.when.toLowerCase());
      await runSteps(follows ? step.steps : (step.otherwise ?? []), input);
    } else if ("say" in step)
      input.say(step.say.replaceAll("{prompt}", input.prompt).replaceAll("{context}", contextPacket(input.context)));
    else if ("tool" in step) await input.tools.run(step.tool, step.input ?? {});
    else if ("write" in step) await input.files.write(step.write.path, step.write.text);
    else if ("wait" in step) await pause(step.wait, input.signal);
    else input.usage(step.cost, step.context ?? null, step.tokens ?? 0);
  }
}

/** The driver of a script. `{prompt}` in a text gives the prompt of the turn, `{context}` its context packet. */
export function scriptDriver(script: AgentScript): AgentDriver {
  const turns = new Map<string, number>();
  return {
    name: "script",
    async turn(input) {
      const index = turns.get(input.session.id) ?? 0;
      const named = script.prompts?.[input.prompt];
      if (named === undefined) turns.set(input.session.id, index + 1);
      await runSteps(named ?? script.turns[Math.min(index, script.turns.length - 1)] ?? [], input);
    },
    close: (session) => turns.delete(session),
    fork: (from, to) => turns.set(to, turns.get(from) ?? 0),
  };
}

/** The script driver of a file. */
export function scriptDriverOf(file: string): AgentDriver {
  return scriptDriver(JSON.parse(readFileSync(file, "utf8")) as AgentScript);
}
