// SPDX-License-Identifier: Apache-2.0
/**
 * The fake agent of the workbench end-to-end tests. It plays a recorded terminal session of Claude Code
 * (fixtures/terminal-session.json) against the host in test mode. Each step is an action of the CLI:
 *
 * - `hook`: the `http` hook of the generated settings (`POST /hooks/<event>`) with the common payload fields;
 * - `tool`: a call of the stdio MCP server (`POST /tools/<name>`);
 * - `edit`: the edit tool writes the file, then the `PostToolUse` hook names it;
 * - `hmr`: the Vite update that the edit causes, as the `hmr` event of the lab frame (the caller sends it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostHook, hostTool, type ToolAnswer } from "./harness";

type Step =
  | { readonly hook: string; readonly payload: Record<string, unknown> }
  | { readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly edit: string; readonly tool_name: string; readonly content: string }
  | { readonly hmr: string };

interface Recording {
  readonly session: string;
  readonly steps: readonly Step[];
}

/** The answer of a step: the hook JSON, the tool result, or the file of an edit or an update. */
export type StepAnswer =
  | { readonly kind: "hook"; readonly event: string; readonly output: Record<string, unknown> }
  | { readonly kind: "tool"; readonly name: string; readonly result: ToolAnswer }
  | { readonly kind: "edit"; readonly file: string }
  | { readonly kind: "hmr"; readonly file: string };

export interface FakeAgentOptions {
  readonly checkout: string;
  /** The scratch file of the run, relative to the checkout. */
  readonly scratch: string;
  /** Send the `hmr` event of a file (an absolute path) from the lab frame. */
  hmr(file: string): Promise<void>;
}

const RECORDING = resolve(import.meta.dirname, "fixtures", "terminal-session.json");

/** The recorded session, with `${checkout}` and `${scratch}` put in. */
function load(options: FakeAgentOptions): Recording {
  const text = readFileSync(RECORDING, "utf8")
    .replaceAll("${checkout}", options.checkout)
    .replaceAll("${scratch}", options.scratch);
  return JSON.parse(text) as Recording;
}

export class FakeAgent {
  readonly session: string;
  readonly #options: FakeAgentOptions;
  readonly #steps: readonly Step[];
  #next = 0;

  constructor(options: FakeAgentOptions) {
    const recording = load(options);
    this.session = recording.session;
    this.#options = options;
    this.#steps = recording.steps;
  }

  /** True when every step ran. */
  get done(): boolean {
    return this.#next >= this.#steps.length;
  }

  /** The payload fields of every hook of the CLI. */
  #common(event: string): Record<string, unknown> {
    return { session_id: this.session, cwd: this.#options.checkout, transcript_path: "", hook_event_name: event };
  }

  /** Play the next step and give its answer. */
  async step(): Promise<StepAnswer> {
    const step = this.#steps[this.#next++];
    if (step === undefined) throw new Error("The recorded session has no more steps.");
    if ("hook" in step) {
      const output = await hostHook(step.hook, { ...this.#common(step.hook), ...step.payload });
      return { kind: "hook", event: step.hook, output };
    }
    if ("tool" in step) return { kind: "tool", name: step.tool, result: await hostTool(step.tool, step.input) };
    if ("edit" in step) {
      const file = resolve(this.#options.checkout, step.edit);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, step.content);
      await hostHook("PostToolUse", {
        ...this.#common("PostToolUse"),
        tool_name: step.tool_name,
        tool_input: { file_path: file, content: step.content },
        tool_response: { type: "create", filePath: file },
      });
      return { kind: "edit", file };
    }
    const file = resolve(this.#options.checkout, step.hmr);
    await this.#options.hmr(file);
    return { kind: "hmr", file };
  }
}
