// SPDX-License-Identifier: Apache-2.0
/**
 * A job of a CLI for the dev server plugins: one child process for each key at a time, the last lines of its output,
 * and its exit code. The dev server runs in Bun, so its executable runs the TypeScript CLI.
 *
 * The file also keeps the journal of the jobs of the dev server for the Jobs panel. Each child process of a plugin goes into it
 * (`trackJob`): its title, its state, its log, its output files (the pictures, the clips and the archives that its
 * output names), and the function that runs it again. A running job can stop (`cancelJob`).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** The state of a job. */
export interface CliJob {
  running: boolean;
  log: string[];
  code: number | null;
  /** The whole standard output of the last run (the JSON report of a `--json` run). */
  stdout: string;
}

/** The most log lines of a job. */
const LOG_LINES = 400;
const jobs = new Map<string, CliJob>();

/** The CLI file of a package (`<package>/src/cli.ts`, from its main entry `src/index.ts`). */
export function cliOf(name: "@scenity/cli" | "@scenity/assets"): string {
  return join(dirname(createRequire(import.meta.url).resolve(name)), "cli.ts");
}

/**
 * The `--lock` arguments of a GPU run: `SCENITY_BENCH_LOCK` names another GPU lock file (a test that holds the lock of
 * the labs tools). The function makes the folder of the file, so the CLI can take the lock.
 */
export function lockArgs(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const lock = env.SCENITY_BENCH_LOCK;
  if (lock === undefined || lock === "") return [];
  mkdirSync(dirname(lock), { recursive: true });
  return ["--lock", lock];
}

/** The state of a job in the journal. */
export type JobRecordState = "running" | "done" | "failed" | "cancelled";

/** One job of the journal. */
export interface JobRecord {
  readonly id: string;
  readonly key: string;
  /** The command line of the job, with the paths of the work folder shortened. */
  readonly title: string;
  readonly cwd: string;
  state: JobRecordState;
  code: number | null;
  readonly startedAt: number;
  endedAt: number | null;
  log: string[];
  /** The output files (absolute) that the output of the job names and that are there. */
  outputs: string[];
}

/** The most jobs in the journal. */
const JOURNAL_SIZE = 100;
const journalList: JobRecord[] = [];
const reruns = new Map<string, () => boolean>();
const children = new Map<string, ChildProcess>();
let counter = 0;

/** The journal of the jobs, the newest first. */
export function journal(): JobRecord[] {
  return journalList.map((record) => ({ ...record, log: [...record.log], outputs: [...record.outputs] }));
}

/** The files of an output text: the paths of pictures, clips and archives that are there. */
export function outputFiles(text: string, cwd: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:"|'|\s|^)([^"'\s]+\.(?:png|jpe?g|webp|webm|mp4|zip|glb))(?=["'\s,]|$)/gim)) {
    const path = match[1] ?? "";
    const full = isAbsolute(path) ? path : resolve(cwd, path);
    if (existsSync(full) && statSync(full).isFile()) found.add(full);
  }
  return [...found];
}

/** The title of a command line: the CLI as its command name, and the work folder as ".". */
function titleOf(args: readonly string[], cwd: string): string {
  return args
    .map((arg, index) => {
      if (index === 0 && arg.endsWith("cli.ts")) return arg.includes("assets") ? "scenity-assets" : "scenity";
      if (arg === cwd) return ".";
      return isAbsolute(arg) && !relative(cwd, arg).startsWith("..") ? relative(cwd, arg) : arg;
    })
    .join(" ");
}

/** Put a child process into the journal. `rerun` runs the same job again (false: it did not start). */
export function trackJob(input: {
  readonly key: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly child: ChildProcess;
  readonly rerun?: () => boolean;
}): JobRecord {
  counter += 1;
  const id = `${String(Date.now())}-${String(counter)}`;
  const record: JobRecord = {
    ...{ id, key: input.key, title: titleOf(input.args, input.cwd), cwd: input.cwd },
    ...{ state: "running", code: null, startedAt: Date.now(), endedAt: null, log: [], outputs: [] },
  };
  journalList.unshift(record);
  for (const old of journalList.splice(JOURNAL_SIZE)) reruns.delete(old.id);
  if (input.rerun !== undefined) reruns.set(id, input.rerun);
  children.set(id, input.child);
  const parts: string[] = [];
  const add = (part: Buffer): void => {
    const text = part.toString("utf8");
    parts.push(text);
    record.log.push(...text.split("\n").filter((line) => line.trim() !== ""));
    if (record.log.length > LOG_LINES) record.log.splice(0, record.log.length - LOG_LINES);
  };
  input.child.stdout?.on("data", add);
  input.child.stderr?.on("data", add);
  const end = (code: number): void => {
    if (record.endedAt !== null) return;
    children.delete(id);
    record.endedAt = Date.now();
    record.code = code;
    if (record.state === "running") record.state = code === 0 ? "done" : "failed";
    record.outputs = outputFiles(parts.join(""), input.cwd);
  };
  input.child.on("error", () => end(1));
  input.child.on("close", (code) => end(code ?? 1));
  return record;
}

/** Run a job of the journal again; false for an unknown job, a job with no rerun, or a key that runs at this time. */
export function rerunJob(id: string): boolean {
  return reruns.get(id)?.() ?? false;
}

/** Stop a running job of the journal; false when it does not run. */
export function cancelJob(id: string): boolean {
  const child = children.get(id);
  const record = journalList.find((item) => item.id === id);
  if (child === undefined || record === undefined) return false;
  record.state = "cancelled";
  child.kill("SIGTERM");
  return true;
}

/** The current job of a key (an empty job before the first run). */
export function jobOf(key: string): CliJob {
  const job = jobs.get(key);
  return job === undefined ? { running: false, log: [], code: null, stdout: "" } : { ...job, log: [...job.log] };
}

/** Start a CLI run for a key; false when a run of the key is active. `done` runs at the end with the job. */
export function startCliJob(key: string, args: readonly string[], cwd: string, done?: (job: CliJob) => void): boolean {
  if (jobs.get(key)?.running === true) return false;
  const job: CliJob = { running: true, log: [], code: null, stdout: "" };
  jobs.set(key, job);
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  const child = spawn(bun, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  trackJob({ key, args, cwd, child, rerun: () => startCliJob(key, args, cwd, done) });
  const out: Buffer[] = [];
  child.stdout.on("data", (part: Buffer) => out.push(part));
  child.stderr.on("data", (part: Buffer) => {
    job.log.push(
      ...part
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== ""),
    );
    if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
  });
  child.on("error", (error) => {
    job.log.push(error.message);
    job.running = false;
    job.code = 1;
  });
  child.on("close", (code) => {
    job.stdout = Buffer.concat(out).toString("utf8");
    job.running = false;
    job.code = code ?? 1;
    done?.(job);
  });
  return true;
}

/** The output of a short run of a CLI. */
export interface CliRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a CLI to its end with no block of the dev server (a request of a page waits for it, the other requests continue).
 * `args` start with the CLI file (`cliOf`).
 */
export function runCli(args: readonly string[], cwd: string, timeout = 30_000): Promise<CliRun> {
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  return new Promise((done) => {
    execFile(
      bun,
      [...args],
      { cwd, timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const status = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        done({ status, stdout, stderr });
      },
    );
  });
}
