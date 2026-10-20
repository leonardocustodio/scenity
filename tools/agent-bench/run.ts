// SPDX-License-Identifier: Apache-2.0
/**
 * The agent benchmark: each case copies a sample, gives a task to an agent and checks the documents after the run.
 *
 *   bun tools/agent-bench/run.ts [--cases <id,id>] [--adapter files|studio] [--budget 1.5] [--turns 40] [--minutes 8]
 *                                [--model <name>] [--out <dir>] [--dry | --solve]
 *
 * `--dry` runs no agent (each check must fail). `--solve` applies the right answers of the tests (each check must
 * pass). `--recheck <dir>` runs the checks again on the projects and transcripts of an earlier run (no agent). The run
 * writes `results.json`, `summary.md` and one transcript per case into `--out` (default `.scenity/agent-bench/<time>`).
 * A real run costs money: the budget is a limit per case.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { filesAdapter, readStream, type Adapter, type AdapterRun } from "./adapters";
import { studioAdapter } from "./studio";
import type { BenchCase } from "./case";
import { CASES } from "./cases";
import { BenchProject, copySample, CHECKOUT } from "./project";
import { summary, totals, type CaseResult } from "./report";
import { SOLUTIONS } from "./solutions";

const { values } = parseArgs({
  options: {
    cases: { type: "string" },
    adapter: { type: "string", default: "files" },
    budget: { type: "string", default: "1.5" },
    turns: { type: "string", default: "40" },
    minutes: { type: "string", default: "8" },
    model: { type: "string" },
    out: { type: "string" },
    dry: { type: "boolean", default: false },
    solve: { type: "boolean", default: false },
    recheck: { type: "string" },
  },
});

const NO_RUN: AdapterRun = {
  answer: "",
  costUsd: null,
  turns: null,
  toolCalls: 0,
  durationMs: 0,
  model: null,
  error: null,
};

function adapterOf(): Adapter {
  if (values.dry) return () => Promise.resolve(NO_RUN);
  if (values.solve) {
    return (project) => {
      const benchCase = CASES.find((c) => project.dir.endsWith(`/${c.id}`));
      const answer = (SOLUTIONS[benchCase?.id ?? ""] ?? benchCase?.solve)?.(project) ?? "";
      return Promise.resolve({ ...NO_RUN, answer });
    };
  }
  const options = {
    budget: Number(values.budget),
    turns: Number(values.turns),
    minutes: Number(values.minutes),
    ...(values.model === undefined ? {} : { model: values.model }),
  };
  // The studio adapter gives the task to a session of Scenity Studio.
  if (values.adapter === "studio") return studioAdapter(options);
  if (values.adapter !== "files") throw new Error(`no adapter ${values.adapter}: "files" or "studio"`);
  return filesAdapter(options);
}

/** The check of a case on the project and the transcript of an earlier run, with the timing of that run. */
function recheck(benchCase: BenchCase, earlier: string, old: CaseResult | undefined): CaseResult {
  rmSync(join(earlier, "recheck", benchCase.id), { recursive: true, force: true });
  const fresh = copySample(benchCase.sample, join(earlier, "recheck", benchCase.id));
  benchCase.setup?.(fresh);
  const before = fresh.scene();
  const transcript = join(earlier, "transcripts", `${benchCase.id}.jsonl`);
  const answer = existsSync(transcript) ? readStream(readFileSync(transcript, "utf8").split("\n")).answer : "";
  const result = benchCase.check(new BenchProject(join(earlier, "projects", benchCase.id)), { before, answer });
  console.log(`${result.pass ? "pass" : "FAIL"} ${benchCase.id}: ${result.detail}`);
  const timing = old ?? { durationMs: null, costUsd: null, turns: null, toolCalls: null, model: null, error: null };
  return {
    ...timing,
    id: benchCase.id,
    category: benchCase.category,
    pass: result.pass,
    detail: result.detail,
  };
}

async function runCase(benchCase: BenchCase, out: string, adapter: Adapter): Promise<CaseResult> {
  const project = copySample(benchCase.sample, join(out, "projects", benchCase.id));
  benchCase.setup?.(project);
  const before = project.scene();
  const run = await adapter(project, benchCase.prompt, join(out, "transcripts", `${benchCase.id}.jsonl`));
  const result = benchCase.check(project, { before, answer: run.answer });
  console.log(`${result.pass ? "pass" : "FAIL"} ${benchCase.id}: ${run.error ?? result.detail}`);
  return {
    id: benchCase.id,
    category: benchCase.category,
    pass: result.pass,
    detail: result.detail,
    durationMs: values.dry || values.solve ? null : run.durationMs,
    costUsd: run.costUsd,
    turns: run.turns,
    toolCalls: values.dry || values.solve ? null : run.toolCalls,
    model: run.model,
    error: run.error,
    ...(run.reviews === undefined ? {} : { reviews: run.reviews }),
  };
}

const wanted = values.cases?.split(",") ?? null;
const cases = CASES.filter((c) => wanted === null || wanted.includes(c.id));
if (values.recheck !== undefined) {
  const earlier = values.recheck;
  const old = (JSON.parse(readFileSync(join(earlier, "results.json"), "utf8")) as { results: CaseResult[] }).results;
  const rechecked = cases.map((c) =>
    recheck(
      c,
      earlier,
      old.find((r) => r.id === c.id),
    ),
  );
  writeFileSync(
    join(earlier, "results.recheck.json"),
    `${JSON.stringify({ mode: "recheck", results: rechecked }, null, 2)}\n`,
  );
  writeFileSync(join(earlier, "summary.recheck.md"), summary(rechecked, "Agent benchmark (recheck)"));
  console.log(`${String(totals(rechecked).passed)} of ${String(rechecked.length)} passed on recheck`);
  process.exit(0);
}
const out = values.out ?? join(CHECKOUT, ".scenity", "agent-bench", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(join(out, "transcripts"), { recursive: true });
const adapter = adapterOf();
const results: CaseResult[] = [];
for (const benchCase of cases) results.push(await runCase(benchCase, out, adapter));
const mode = values.dry ? "dry" : values.solve ? "solve" : values.adapter;
writeFileSync(join(out, "results.json"), `${JSON.stringify({ mode, results }, null, 2)}\n`);
writeFileSync(join(out, "summary.md"), summary(results, `Agent benchmark (${mode})`));
const t = totals(results);
console.log(`${String(t.passed)} of ${String(t.total)} passed; results in ${out}`);
