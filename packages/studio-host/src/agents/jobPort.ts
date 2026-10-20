// SPDX-License-Identifier: Apache-2.0
/**
 * The jobs of the agent sessions: the job tools of `@scenity/agent-tools` (`job_run`, `job_status`, `job_output`) over
 * the jobs of the studio (jobs.ts), in the folder of the project of the session. An agent starts only the commands of
 * `AGENT_JOBS`. Its arguments are a command line (`--scene x --json`), and the port reads it into the typed arguments
 * of the job. The Jobs panel shows the same jobs.
 */
import type { JobCommand, JobInfo, JobPort } from "@scenity/agent-tools";
import { JOB_COMMANDS, type JobService } from "../jobs";

/** A typed argument of a job. */
type JobArg = string | number | boolean | string[];

/** The commands that an agent of the studio can start. */
export const AGENT_JOBS: readonly JobCommand[] = [
  { id: "check", label: "scenity check" },
  { id: "build", label: "scenity build" },
  { id: "shot", label: "scenity shot" },
  { id: "sheet", label: "scenity sheet" },
  { id: "assets.build", label: "scenity assets build" },
  { id: "assets.missing", label: "scenity assets missing" },
  { id: "assets.used-by", label: "scenity assets used-by" },
];

/** The typed arguments of a command line of a job command. Throw for an unknown flag or a missing value. */
export function argsRecord(command: string, args: readonly string[]): Record<string, JobArg> {
  const spec = JOB_COMMANDS[command];
  if (spec === undefined) throw new Error(`no job command ${command}`);
  const out: Record<string, JobArg> = {};
  const positional = [...(spec.positional ?? [])];
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    if (!arg.startsWith("--")) {
      const name = positional.shift();
      if (name === undefined) throw new Error(`${command} takes no more values ("${arg}")`);
      out[name] = arg;
      continue;
    }
    const [name = "", inline] = arg.slice(2).split("=", 2);
    const kind = spec.flags[name];
    if (kind === undefined) throw new Error(`${command} has no flag --${name}`);
    if (kind === "boolean") {
      out[name] = inline === undefined ? true : inline !== "false";
      continue;
    }
    const value = inline ?? args[++at];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    out[name] = kind === "number" ? Number(value) : kind === "list" ? value.split(",") : value;
  }
  return out;
}

/** The job port of a session: the jobs of the studio in the project folder. */
export function studioJobPort(jobs: JobService, dir: string, project: string): JobPort {
  const allowed = new Set(AGENT_JOBS.map((job) => job.id));
  const infoOf = (id: string): JobInfo | null => {
    const job = jobs.get(id);
    if (job === undefined) return null;
    const log = jobs.log(id);
    return {
      run: job.id,
      command: job.command,
      args: job.argv,
      line: `scenity ${job.argv.join(" ")}`,
      status: job.state,
      code: job.exitCode,
      summary: log.at(-1) ?? "",
      outDir: job.outputs[0] ?? null,
    };
  };
  return {
    start: (command, args) => {
      if (!allowed.has(command)) throw new Error(`an agent does not start ${command}`);
      return jobs.start({ command, args: argsRecord(command, args), cwd: dir, project }).id;
    },
    info: infoOf,
    output: (id, lines) => (jobs.get(id) === undefined ? null : jobs.log(id).slice(-lines)),
  };
}
