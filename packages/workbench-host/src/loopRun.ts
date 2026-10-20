// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of one background run: the check of the
 * parameters, the command line of the unmodified `claude` CLI, the stop gate and the review pack of the project for
 * the sequence of the run, the files that the run changed and the summary record. loops.ts holds the runs and their
 * processes.
 */
import { mkdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { gitStatus } from "./git";
import { fromTop } from "./workspace";
import { isIntentId, type LoopInfo, type LoopParams, type ProjectRun } from "./protocol";
import { reviewRun, runsFor, sequenceArgs, type RunCatalog } from "./runCatalog";
import { writeJsonAtomic } from "./state";
import type { GateRuns } from "./stopGate";

/** The limits of the parameters of a background run. */
export const LOOP_LIMITS = { budgetUsd: 50, maxTurns: 500, minutes: 600, prompt: 20_000 } as const;

/** A sequence: a name or a path in the project (`scenity check --sequence`), with no `..` and no leading `/`. */
const SEQUENCE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;
const MODEL = /^[A-Za-z0-9._[\]-]{1,80}$/;

function positive(value: unknown, name: string, max: number, integer: boolean): number {
  const good = typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
  if (!good || (integer && !Number.isInteger(value))) {
    throw new Error(
      `The parameter "${name}" must be a${integer ? " whole" : ""} number above 0 and at most ${String(max)}.`,
    );
  }
  return value;
}

function optional(value: unknown, pattern: RegExp, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`The parameter "${name}" is not valid.`);
  return value;
}

/** The checked parameters of a background run. */
export interface LoopPlan {
  readonly prompt: string;
  /** The sequence of the stop gate and of the review pack, or null. */
  readonly sequence: string | null;
  readonly intent: string | null;
  readonly budgetUsd: number;
  readonly maxTurns: number;
  readonly minutes: number;
  readonly model: string | null;
  readonly worktree: boolean;
}

/** Check the parameters of `loops.start`. Throw an error with the name of a bad parameter. */
export function checkLoopParams(params: Partial<LoopParams>): LoopPlan {
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (prompt === "" || prompt.length > LOOP_LIMITS.prompt) {
    throw new Error(`The parameter "prompt" must be a text of 1 to ${String(LOOP_LIMITS.prompt)} characters.`);
  }
  const intent = params.intent ?? null;
  if (intent !== null && !isIntentId(intent)) throw new Error('The parameter "intent" is not an intent ID.');
  // `sequence`, or the old name `take`.
  const sequence =
    params.sequence === undefined
      ? optional(params.take, SEQUENCE, "take")
      : optional(params.sequence, SEQUENCE, "sequence");
  return {
    prompt,
    sequence,
    intent,
    budgetUsd: positive(params.budgetUsd, "budgetUsd", LOOP_LIMITS.budgetUsd, false),
    maxTurns: positive(params.maxTurns, "maxTurns", LOOP_LIMITS.maxTurns, true),
    minutes: positive(params.minutes, "minutes", LOOP_LIMITS.minutes, false),
    model: optional(params.model, MODEL, "model"),
    worktree: params.worktree === true,
  };
}

/**
 * The command line of a background run: the unmodified CLI in print mode with every permission, the limits, the
 * stream of JSON lines, the generated MCP config (strict: no other server) and the generated settings.
 */
export function loopArgv(
  claude: string,
  plan: LoopPlan,
  files: { readonly mcpConfig: string; readonly settings: string },
): string[] {
  return [
    claude,
    "-p",
    plan.prompt,
    "--permission-mode",
    "bypassPermissions",
    "--max-turns",
    String(plan.maxTurns),
    "--max-budget-usd",
    String(plan.budgetUsd),
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    files.mcpConfig,
    "--strict-mcp-config",
    "--settings",
    files.settings,
    ...(plan.model === null ? [] : ["--model", plan.model]),
  ];
}

/** What the gate and the review need of the runs of the host. */
export type LoopRuns = GateRuns;

/** The gate and the review pack of a run: the runs of the project that apply to the sequence of the run. */
export interface LoopChecks {
  readonly gate: ProjectRun | null;
  readonly review: ProjectRun | null;
}

/** The gate and the review pack of a sequence. A run that needs a sequence does not apply without one. */
export function loopChecks(catalog: RunCatalog, sequence: string | null): LoopChecks {
  const gate = catalog.gate !== null && runsFor(catalog.gate, sequence) ? catalog.gate : null;
  const review = reviewRun(catalog);
  return { gate, review: review !== null && runsFor(review, sequence) ? review : null };
}

/** The arguments of the review pack: the sequence and `--ref <start head>` when the run takes a ref. */
export function reviewArgs(review: ProjectRun, sequence: string | null, ref: string): string[] {
  return [...sequenceArgs(review, sequence), ...(review.ref ? ["--ref", ref] : [])];
}

/** The ends of the CLI in words (the subtypes of its result, and `timeout` of the host). */
const END_WORDS: Readonly<Record<string, string>> = {
  error_max_turns: "ended at the turn limit",
  error_max_budget_usd: "ended at the budget",
  timeout: "ended at the time limit",
  success: "ended without a gate verdict",
};

/** The end of a run in words, for the gate check after the end. */
export function endWords(stopReason: string | null): string {
  return END_WORDS[stopReason ?? ""] ?? `ended with an error (${stopReason ?? "no result"})`;
}

/**
 * True when the host must run the gate check after the end of a run: the run has a gate, the owner did not
 * stop it, and the `Stop` gate did not give the last verdict. The CLI calls the `Stop` hook only when Claude ends a
 * turn by itself; at the turn limit, the budget, the time limit or an error it calls no hook.
 */
export function needsEndCheck(
  hasGate: boolean,
  end: { readonly stopped: boolean; readonly success: boolean; readonly gateVerdict: boolean },
): boolean {
  if (!hasGate || end.stopped) return false;
  return !(end.success && end.gateVerdict);
}

/** A file path of a hook, relative to the checkout (an absolute path outside it stays absolute). */
export function checkoutRelative(checkout: string, file: string): string {
  if (!isAbsolute(file)) return file;
  const near = relative(checkout, file);
  return near.startsWith("..") || isAbsolute(near) ? file : near;
}

/**
 * The changed files of a run: the edits of its hooks and the files of `git status` that were clean at the start.
 * `rel` is the checkout from the Git top folder; the files are paths from the checkout.
 */
export async function changedFiles(
  checkout: string,
  edited: ReadonlySet<string>,
  dirtyAtStart: ReadonlySet<string>,
  rel = "",
): Promise<string[]> {
  const now = await gitStatus(checkout).catch(() => ({ files: [] }));
  const files = new Set(edited);
  for (const file of now.files) {
    const path = fromTop(file.path, rel);
    if (!dirtyAtStart.has(path)) files.add(path);
  }
  return [...files].sort();
}

/** Write the summary record of a run: `<state>/loops/<id>.json`. Give its path. */
export function writeLoopRecord(stateDir: string, info: LoopInfo, lines: readonly string[]): string {
  const dir = join(stateDir, "loops");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${info.loop}.json`);
  writeJsonAtomic(path, { ...info, record: path, lines: lines.slice(-200) });
  return path;
}
