// SPDX-License-Identifier: Apache-2.0
/**
 * The experiment log of the workbench: every run of the project (its command line and its sequence) and every
 * background run, with its result, as one JSON line in `<state>/experiments.jsonl`. When the run has an intent, the
 * same line also goes to `apps/editor/intents/<id>/runs/<date>.jsonl` of its checkout (a folder that Git ignores).
 * The owner and an agent after a context reset find a run by its sequence (the field `take`), its command, its date
 * or a text.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  endCheckLine,
  isIntentId,
  isRecord,
  parseJson,
  takeOfArgs,
  type ExperimentEntry,
  type ExperimentQuery,
  type LoopInfo,
  type RunInfo,
} from "./protocol";
import { SETUP_LINE } from "./checkoutSetup";
import { flagValue, WEB_DIR } from "./runArgs";
import { activeRunCatalog, runOf, type RunCatalog } from "./runCatalog";

/** The log file in the state folder. */
export const EXPERIMENTS_FILE = "experiments.jsonl";
/** The most entries of one search. */
export const MAX_RESULTS = 200;

/** The runs folder of an intent in a checkout: `apps/editor/intents/<id>/runs` (ignored by Git). */
export function intentRunsDir(checkout: string, intent: string): string {
  return join(checkout, WEB_DIR, "apps", "editor", "intents", intent, "runs");
}

/** The sequence of a run: the value of the sequence flag of its run, else the take of its arguments. */
function sequenceOf(run: RunInfo, catalog: RunCatalog): string | null {
  const flag = runOf(catalog, run.command)?.sequence?.flag;
  const given = flag === undefined || flag === "" ? undefined : flagValue(run.args, flag);
  return given ?? takeOfArgs(run.args, flag === "");
}

/** The command line of a run: a host run, or the command line of a run of the project. */
function commandOf(run: RunInfo): string {
  // The import job of a dropped file is a run of the host, not a run of the project.
  if (run.command === "setup") return SETUP_LINE;
  return run.command === "import" ? "import" : (run.line ?? run.command);
}

/** The entry of a run of the project that ended. */
export function runEntry(run: RunInfo, intent: string | null, catalog = activeRunCatalog()): ExperimentEntry {
  return {
    id: run.run,
    kind: "run",
    checkout: run.checkout,
    intent,
    at: run.started,
    ended: run.ended,
    command: commandOf(run),
    args: run.args.filter((arg, index, all) => arg !== "--out" && all[index - 1] !== "--out"),
    take: sequenceOf(run, catalog),
    status: run.status,
    code: run.code,
    summary: run.summary,
    outDir: run.outDir,
  };
}

/** The entry of a background run that ended. */
export function loopEntry(loop: LoopInfo): ExperimentEntry {
  return {
    id: loop.loop,
    kind: "loop",
    checkout: loop.checkout,
    intent: loop.intent,
    at: loop.started,
    ended: loop.ended,
    command: "claude -p",
    args: [loop.prompt],
    take: loop.sequence ?? loop.take,
    status: loop.status,
    code: null,
    summary: [
      loop.stopReason ?? "",
      loop.result ?? "",
      loop.gate.last ?? "",
      loop.endCheck === null ? "" : endCheckLine(loop.endCheck),
    ]
      .filter((part) => part !== "")
      .join(" · "),
    outDir: loop.review?.outDir ?? null,
    costUsd: loop.costUsd,
    turns: loop.turns,
    files: loop.files,
  };
}

function isEntry(value: unknown): value is ExperimentEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.command === "string" &&
    Array.isArray(value.args)
  );
}

function day(value: string | undefined, end: boolean): number | null {
  if (value === undefined || value === "") return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? "23:59:59.999" : "00:00:00"}Z` : value);
  return Number.isFinite(time) ? time : null;
}

/** True when an entry matches a query. */
export function matches(entry: ExperimentEntry, query: ExperimentQuery): boolean {
  const has = (field: string | null | undefined, needle: string | undefined): boolean =>
    needle === undefined || needle === "" || (field ?? "").toLowerCase().includes(needle.toLowerCase());
  if (!has(entry.take, query.take) || !has(entry.command, query.command) || !has(entry.intent, query.intent)) {
    return false;
  }
  const at = Date.parse(entry.at);
  const from = day(query.from, false);
  const to = day(query.to, true);
  if ((from !== null && at < from) || (to !== null && at > to)) return false;
  if (query.text === undefined || query.text === "") return true;
  const all = [entry.summary, entry.args.join(" "), entry.status, entry.checkout, ...(entry.files ?? [])].join("\n");
  return all.toLowerCase().includes(query.text.toLowerCase());
}

export interface ExperimentLogOptions {
  readonly stateDir: string;
}

/** The experiment log of one host. */
export class ExperimentLog {
  readonly file: string;

  constructor(options: ExperimentLogOptions) {
    this.file = join(options.stateDir, EXPERIMENTS_FILE);
  }

  /** Add an entry: one line in the state folder, and one in the runs folder of its intent. */
  add(entry: ExperimentEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    appendFileSync(this.file, line, { mode: 0o600 });
    if (entry.intent !== null && isIntentId(entry.intent)) {
      const dir = intentRunsDir(entry.checkout, entry.intent);
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `${entry.at.slice(0, 10)}.jsonl`), line);
      } catch {
        // The checkout has gone (a removed worktree): the state folder keeps the entry.
      }
    }
  }

  /** Every entry of the log, the oldest first. A bad line is left out. */
  all(): ExperimentEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .map((line) => (line.trim() === "" ? undefined : parseJson(line)))
      .filter(isEntry);
  }

  /** The entries that match the query, the newest first, at most `limit` (default 50, at most MAX_RESULTS). */
  search(query: ExperimentQuery = {}): ExperimentEntry[] {
    const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(query.limit ?? 50)));
    return this.all()
      .filter((entry) => matches(entry, query))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);
  }
}
