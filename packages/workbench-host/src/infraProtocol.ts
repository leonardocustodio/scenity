// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the agent infrastructure: the background runs, the picker, the experiment log, the settings of a
 * checkout (the Blender MCP) and the windows. `protocol.ts` exports them. This module is pure (no `node:` or `bun:`
 * import), so the page gets them through `@scenity/workbench-host/protocol`.
 */
import type { RunStatus } from "./changesProtocol";

/** The state of a background run. */
export type LoopStatus = "starting" | "running" | "checking" | "done" | "failed" | "stopped" | "timeout";

/**
 * The setup of a new worktree: `bun install --frozen-lockfile` and `bun run generate` as the run `run` (the
 * command `setup` of the Runs tab). `preparing`: the setup runs, and the checkout does not open yet.
 */
export interface CheckoutSetup {
  readonly state: "preparing" | "failed";
  readonly run: string;
}

/** The steps of the setup of a new worktree: the arguments of Bun, in the root of the checkout. */
export const CHECKOUT_SETUP_STEPS: readonly (readonly string[])[] = [
  ["install", "--frozen-lockfile"],
  ["run", "generate"],
];

/** The command line of the setup, for a list. */
export const CHECKOUT_SETUP_LINE = CHECKOUT_SETUP_STEPS.map((step) => `bun ${step.join(" ")}`).join(" && ");

/** The parameters of a background run. */
export interface LoopParams {
  /** The prompt of `claude -p`. */
  readonly prompt: string;
  /**
   * The sequence of the stop gate and of the review pack (a name or a path in the project), or null. A gate
   * or a pack that needs a sequence does not run without one; `scenity check` runs with no sequence.
   */
  readonly sequence?: string | null;
  /** The old name of `sequence` (the take of the lab), kept for compatibility. */
  readonly take?: string | null;
  /** The intent pack of the run, or null. The experiment log files the run under it. */
  readonly intent?: string | null;
  /** The budget of the run in USD (`--max-budget-usd`). */
  readonly budgetUsd: number;
  /** The most model requests (`--max-turns`). */
  readonly maxTurns: number;
  /** The hard wall-clock limit in minutes. */
  readonly minutes: number;
  /** The model (`--model`), or null for the default of the CLI. */
  readonly model?: string | null;
  /** True: the run works in a new worktree from the HEAD of the open checkout (a candidate of the picker). */
  readonly worktree?: boolean;
}

/** The review pack of a background run: the run of the kind `review` of the project for the sequence. */
export interface LoopReview {
  readonly run: string;
  readonly status: RunStatus;
  readonly outDir: string | null;
}

/**
 * The gate check of the host after an end that the `Stop` gate did not approve: the turn limit, the budget,
 * the time limit or an error. The CLI calls no `Stop` hook at such an end, so the host runs the gate run of the
 * project in the checkout of the run.
 */
export interface LoopEndCheck {
  /** The end of the run in words: "ended at the turn limit", "ended at the budget", "ended with an error (…)". */
  readonly end: string;
  readonly pass: boolean;
  /** The failures of the check (the summary of the gate run), or the error of the check. */
  readonly summary: string;
  /** The ISO time of the check. */
  readonly at: string;
}

/** The verdict line of a gate check after the end: "ended at the turn limit; gate: fail: <the first failure>". */
export function endCheckLine(check: LoopEndCheck): string {
  if (check.pass) return `${check.end}; gate: pass`;
  const first = check.summary.split("\n").find((line) => line.trim() !== "");
  return `${check.end}; gate: fail${first === undefined ? "" : `: ${first.trim()}`}`;
}

/** One background run. */
export interface LoopInfo {
  readonly loop: string;
  /** The checkout of the run (the open checkout, or the new worktree). */
  readonly checkout: string;
  readonly prompt: string;
  /** The sequence of the stop gate and of the review pack, or null. */
  readonly sequence?: string | null;
  /** The old name of `sequence`, kept for compatibility. */
  readonly take: string | null;
  readonly intent: string | null;
  readonly budgetUsd: number;
  readonly maxTurns: number;
  readonly minutes: number;
  readonly model: string | null;
  readonly status: LoopStatus;
  /** ISO times. */
  readonly started: string;
  readonly ended: string | null;
  /** The commit at the start; the review pack compares with it. */
  readonly startHead: string | null;
  /** The commit at the end. It must equal `startHead`, because a run never commits. */
  readonly endHead: string | null;
  readonly session: string | null;
  /** The model requests of the run (`num_turns` of the result). */
  readonly turns: number | null;
  /** The cost estimate of the CLI (`total_cost_usd`; not the bill). */
  readonly costUsd: number | null;
  /** The subtype of the result (`success`, `error_max_turns`, …), or `timeout`, `stopped`, `exit <code>`. */
  readonly stopReason: string | null;
  /** The last text of Claude (at most 2000 characters). */
  readonly result: string | null;
  /** The files that the run changed, relative to the checkout. */
  readonly files: readonly string[];
  /** The refusals of the `Stop` gate and its last verdict. */
  readonly gate: { readonly refusals: number; readonly last: string | null };
  /** The gate check of the host after an end that the `Stop` gate did not approve, or null (LoopEndCheck). */
  readonly endCheck: LoopEndCheck | null;
  readonly review: LoopReview | null;
  /** The summary record of the run (a JSON file in the state folder), or null before the end. */
  readonly record: string | null;
  /** The last progress lines (`loops.list` only). */
  readonly lines?: readonly string[];
}

/** One entry of the experiment log: a run of the project or a background run, with its result. */
export interface ExperimentEntry {
  readonly id: string;
  readonly kind: "run" | "loop";
  readonly checkout: string;
  readonly intent: string | null;
  /** ISO times of the start and of the end. */
  readonly at: string;
  readonly ended: string | null;
  /** The command line of the run (an old entry: `labs <command>`), or `claude -p`. */
  readonly command: string;
  readonly args: readonly string[];
  /** The sequence of the run (the stop gate of a background run), or null. The field keeps its old name. */
  readonly take: string | null;
  readonly status: string;
  readonly code: number | null;
  /** The last lines of the output, or the result of Claude. */
  readonly summary: string;
  readonly outDir: string | null;
  readonly costUsd?: number | null;
  readonly turns?: number | null;
  readonly files?: readonly string[];
}

/** The filter of `experiments.search`. Every field is optional; the texts match without case. */
export interface ExperimentQuery {
  readonly take?: string;
  readonly command?: string;
  readonly text?: string;
  readonly intent?: string;
  /** ISO dates (`2026-10-05` or a full time): the start of the entry is in the range. */
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

/** A candidate of the picker: a set of tune values of the lab, or a worktree (of a background run). */
export interface PickCandidate {
  readonly id: string;
  readonly label: string;
  readonly kind: "tune" | "worktree";
  /** `tune`: the tune text `path:value,path:value` (empty: the defaults). */
  readonly tune?: string;
  /** `worktree`: the absolute path of the worktree. */
  readonly path?: string;
}

/** The window and the cameras of the sheets of one pick: the same for every candidate. */
export interface PickWindow {
  readonly take: string;
  readonly from: number;
  readonly to: number;
  readonly step: number;
  readonly cameras: readonly string[];
}

/**
 * The sheet of one candidate. `picture` (an ID of the picture store) for a tune candidate; `run` and `image`
 * for a worktree candidate.
 */
export interface PickSheet {
  readonly job: string;
  readonly candidate: string;
  readonly mime: string | null;
  readonly picture: string | null;
  readonly run: string | null;
  readonly image: string | null;
  readonly error: string | null;
}

/** The settings of a checkout. */
export interface CheckoutSettings {
  /** True: the generated MCP config of the terminal and of the background runs adds the owner's Blender server. */
  readonly blender: boolean;
  /** True when the owner's user settings have a Blender MCP server (`mcpServers.blender`). */
  readonly blenderFound: boolean;
  /** The intent of the runs of the checkout (the experiment log), or null. */
  readonly intent: string | null;
  /**
   * True when the visible lab frame loads the built lab of the render pool (no HMR; for a window where the
   * owner does not edit). Default false. The shadow frame uses the built lab always when it is ready.
   */
  readonly builtLab: boolean;
}

/** The requests of the agent infrastructure (page to host). `RequestMap` of protocol.ts extends this map. */
export interface InfraRequests {
  /** Start a background run. The answer comes immediately. `loops.state` and `loops.progress` follow. */
  "loops.start": { params: LoopParams; result: LoopInfo };
  /** Stop a background run (SIGINT, then SIGTERM, then SIGKILL). */
  "loops.stop": { params: { loop: string }; result: null };
  /** The background runs of this host, the newest first, with their last progress lines. */
  "loops.list": { params: object; result: LoopInfo[] };
  /** Search the experiment log of this host, the newest first. */
  "experiments.search": { params: ExperimentQuery; result: ExperimentEntry[] };
  /** The candidates that the host knows: the current tunes of the lab, the defaults and the run worktrees. */
  "picker.candidates": { params: object; result: PickCandidate[] };
  /** Make the sheets of the candidates. The answer is a job ID; a `picker.sheet` event comes per candidate. */
  "picker.sheets": { params: { window: PickWindow; candidates: PickCandidate[] }; result: { job: string } };
  /**
   * Record a pick in `apps/editor/intents/<intent>/labels.jsonl`: one pairwise label per other candidate. A
   * null `winner` is a skip (one line, no labels).
   */
  "picker.pick": {
    params: {
      intent: string;
      window: PickWindow;
      candidates: PickCandidate[];
      winner: string | null;
      why?: string;
    };
    result: { file: string; labels: number };
  };
  /** The settings of the open checkout, and a change of them when a field is present. */
  "checkout.settings": {
    params: { blender?: boolean; intent?: string | null; builtLab?: boolean };
    result: CheckoutSettings;
  };
  /**
   * Start a second host for another checkout (browser mode). The answer is its endpoint; the page opens a new
   * tab on it. The labs app uses its own command `open_window` instead.
   */
  "windows.open": { params: { path: string }; result: { origin: string; token: string; checkout: string } };
}

/** The events of the agent infrastructure (host to page). `EventMap` of protocol.ts extends this map. */
export interface InfraEvents {
  /** A progress line of a background run (a text of Claude, a tool call, a gate verdict, a step). */
  "loops.progress": { loop: string; line: string };
  /** The state of a background run after a change. */
  "loops.state": { loop: LoopInfo };
  /** The sheet of one candidate of a picker job. */
  "picker.sheet": { sheet: PickSheet };
}

export const INFRA_REQUEST_NAMES: Readonly<Record<keyof InfraRequests, true>> = {
  "loops.start": true,
  "loops.stop": true,
  "loops.list": true,
  "experiments.search": true,
  "picker.candidates": true,
  "picker.sheets": true,
  "picker.pick": true,
  "checkout.settings": true,
  "windows.open": true,
};

export const INFRA_EVENT_NAMES: Readonly<Record<keyof InfraEvents, true>> = {
  "loops.progress": true,
  "loops.state": true,
  "picker.sheet": true,
};

/** An intent ID: lowercase letters, digits and `-`, at most 64 characters. */
export const INTENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** True for an intent ID. */
export function isIntentId(value: unknown): value is string {
  return typeof value === "string" && INTENT_PATTERN.test(value);
}

/** The labels file of an intent, relative to the repo root. */
export function labelsPath(intent: string): string {
  return `apps/editor/intents/${intent}/labels.jsonl`;
}

/**
 * The sequence of the arguments of a run: `--take <name>`, the take of `--item take:<name>`, or the first positional
 * argument of a run that takes the sequence first (`positional`). Null when the arguments name none.
 */
export function takeOfArgs(args: readonly string[], positional = false): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--take") return args[index + 1] ?? null;
    if (arg.startsWith("--take=")) return arg.slice("--take=".length);
    if (arg === "--item" && (args[index + 1] ?? "").startsWith("take:")) return (args[index + 1] ?? "").slice(5);
  }
  if (!positional) return null;
  const flagsWithValue = new Set(["--ref", "--camera", "--every", "--out", "--review"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      if (flagsWithValue.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return null;
}
