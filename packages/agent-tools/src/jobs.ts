// SPDX-License-Identifier: Apache-2.0
/**
 * The job tools: the CLI commands of the project for an agent, as jobs that it starts and reads later. The commands are
 * `scenity check`, `build`, `shot`, and the runs of the project manifest and of the host plugins. `job_run` starts a
 * job and gives its ID at once. `job_status` gives its state. `job_output` gives the last lines of its output. The
 * owner sees the same jobs in the Runs tab. `workbench_run` is different: it starts a run and waits for its end.
 */
import { z } from "zod";
import type { SceneToolContext } from "./context";

/** The state of a job (the same fields as the `RunInfo` of the workbench host, with no output). */
export interface JobInfo {
  readonly run: string;
  readonly command: string;
  readonly args: readonly string[];
  /** The command line, or null. */
  readonly line?: string | null;
  readonly status: string;
  readonly code: number | null;
  readonly summary: string;
  readonly outDir: string | null;
}

/** A command that an agent can start as a job: its ID and its label. */
export interface JobCommand {
  readonly id: string;
  readonly label: string;
}
import { defineTool, textResult, type ToolDef, type ToolResult } from "./kit";

/** The jobs of the host for the tools (the run manager of the open checkout). */
export interface JobPort {
  /** Start a job; its ID. Throw for a bad command or a busy GPU. */
  start(command: string, args: readonly string[]): string;
  /** The state of a job, or null. */
  info(job: string): JobInfo | null;
  /** The last lines of the output of a job, or null. */
  output(job: string, lines: number): readonly string[] | null;
}

const ARGS = z.array(z.string().max(1000)).max(40).optional().describe("The arguments after the command line.");
const JOB = z.string().min(1).describe("The ID of the job (job_run gives it).");

function jobsOf(ctx: SceneToolContext, tool: string): JobPort {
  if (ctx.jobs === undefined) throw new Error(`the host has no jobs (${tool} needs a run manager).`);
  return ctx.jobs;
}

function runJob(input: { command: string; args?: string[] }, ctx: SceneToolContext): Promise<ToolResult> {
  const job = jobsOf(ctx, "job_run").start(input.command, input.args ?? []);
  return Promise.resolve(
    textResult([
      `Job ${job} started: ${[input.command, ...(input.args ?? [])].join(" ")}.`,
      "job_status gives its state; job_output gives its output. The owner sees it in the Runs tab.",
    ]),
  );
}

const RUN_TEXT =
  "Start a CLI command of the project as a job (a run of `workbench.runs` of the project manifest or of a host " +
  "plugin, for example the check, the build or a shot) and get its job ID at once. Read it later with job_status " +
  "and job_output.";

/** `job_run` for the runs of the open project that the agent can start; null for a project with no such run. */
export function jobRunFor(runs: readonly JobCommand[]): ToolDef | null {
  const [first, ...rest] = runs.map((run) => run.id);
  if (first === undefined) return null;
  const names = runs.map((run) => (run.label === run.id ? run.id : `${run.id} (${run.label})`)).join(", ");
  return defineTool({
    name: "job_run",
    description: `${RUN_TEXT} Commands: ${names}.`,
    input: z.object({ command: z.enum([first, ...rest]).describe("The ID of the command."), args: ARGS }),
    alwaysLoad: false,
    handler: runJob,
  });
}

/** The place of `job_run` in the core tools; `workbenchTools()` sets the runs of the open project. */
export const jobRun = defineTool({
  name: "job_run",
  description: RUN_TEXT,
  input: z.object({ command: z.string().min(1).describe("The ID of the command."), args: ARGS }),
  alwaysLoad: false,
  handler: runJob,
});

export const jobStatus = defineTool({
  name: "job_status",
  description:
    "The state of a job: running, done, failed or cancelled; its exit code, its summary and its output folder.",
  input: z.object({ job: JOB }),
  alwaysLoad: false,
  handler(input, ctx) {
    const info = jobsOf(ctx, "job_status").info(input.job);
    if (info === null) throw new Error(`no job "${input.job}".`);
    return Promise.resolve(
      textResult([
        `Job ${info.run}: ${[info.line ?? info.command, ...info.args].join(" ")} · ${info.status}${info.code === null ? "" : ` (exit ${String(info.code)})`}`,
        info.summary === "" ? "No summary yet." : info.summary,
        `Output folder: ${info.outDir ?? "none"}`,
      ]),
    );
  },
});

export const jobOutput = defineTool({
  name: "job_output",
  description: "The last lines of the output of a job (default 100 lines).",
  input: z.object({ job: JOB, lines: z.number().int().min(1).max(1000).optional().describe("The number of lines.") }),
  alwaysLoad: false,
  handler(input, ctx) {
    const lines = jobsOf(ctx, "job_output").output(input.job, input.lines ?? 100);
    if (lines === null) throw new Error(`no job "${input.job}".`);
    return Promise.resolve(textResult(lines.length === 0 ? ["No output yet."] : [...lines]));
  },
});
