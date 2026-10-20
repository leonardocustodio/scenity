// SPDX-License-Identifier: Apache-2.0
/**
 * The jobs of the studio: each `scenity` command as a job with typed arguments, its log, its output files, a cancel
 * and a queue for the GPU. A job runs the CLI of the checkout in the project folder, with no shell. One GPU job runs
 * at a time (the CLI also takes the machine-wide GPU lock). A cancel sends SIGINT to the process group, then SIGTERM,
 * then SIGKILL.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { childEnv, LogRing } from "./process";
import { cliCommand } from "./runtime";

/** The kinds of the arguments of a command: a flag with a value, a switch, a list (comma text) or a position. */
type Kind = "string" | "number" | "boolean" | "list";
interface CommandSpec {
  /** A fixed program in place of the CLI (the fixes of the doctor). */
  readonly program?: readonly string[];
  /** The CLI words before the arguments (`["assets", "build"]`). */
  readonly words: readonly string[];
  readonly flags: Readonly<Record<string, Kind>>;
  /** Arguments that go first, with no flag name, in this order. */
  readonly positional?: readonly string[];
  readonly gpu: boolean;
  /** The flag of the output file or folder, so the job lists it as an output. */
  readonly outFlag?: string;
  /** A check of the arguments before the job starts. It throws for a value that is not allowed. */
  readonly check?: (args: Readonly<Record<string, unknown>>) => void;
}

/** The repository addresses that a clone accepts: HTTPS, SSH and local `file://` URLs (no other Git transport). */
export const CLONE_URL = /^(https:\/\/|ssh:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)[^\s]+$/;
/** A folder name of a clone: one part of a path. */
const FOLDER_NAME = /^(?!\.{1,2}$)[\w.-]{1,64}$/;

const RENDER = { scene: "string", sequence: "string", camera: "list", tier: "string", backend: "string" } as const;

/** The commands that a job runs, with their arguments. */
export const JOB_COMMANDS: Readonly<Record<string, CommandSpec>> = {
  check: {
    words: ["check"],
    flags: { scene: "string", sequence: "string", tier: "string", json: "boolean" },
    gpu: false,
  },
  build: { words: ["build"], flags: { out: "string", check: "boolean", json: "boolean" }, gpu: false, outFlag: "out" },
  verify: { words: ["verify"], flags: { "no-shots": "boolean" }, gpu: true },
  shot: {
    words: ["shot"],
    flags: {
      ...RENDER,
      at: "number",
      size: "string",
      out: "string",
      compare: "string",
      build: "boolean",
      json: "boolean",
    },
    gpu: true,
    outFlag: "out",
  },
  sheet: {
    words: ["sheet"],
    flags: { ...RENDER, times: "list", from: "number", to: "number", step: "number", cell: "number", out: "string" },
    gpu: true,
    outFlag: "out",
  },
  // The frame index of the project.
  frames: {
    words: ["frames"],
    flags: { step: "number", size: "string", backend: "string", build: "boolean", json: "boolean" },
    gpu: true,
  },
  clip: {
    words: ["clip"],
    flags: { ...RENDER, from: "number", to: "number", fps: "number", size: "string", out: "string" },
    gpu: true,
    outFlag: "out",
  },
  bench: {
    words: ["bench"],
    flags: { ...RENDER, quick: "boolean", check: "boolean", json: "boolean", out: "string" },
    gpu: true,
  },
  pool: { words: ["pool"], positional: ["action"], flags: { pages: "number" }, gpu: false },
  create: {
    words: ["create"],
    positional: ["name"],
    // `from` is the folder of a template of the person or of a plugin (the API sets it from a template ID).
    flags: { template: "string", from: "string", version: "string", install: "boolean", json: "boolean" },
    gpu: false,
  },
  "assets.import": {
    words: ["assets", "import"],
    positional: ["file"],
    flags: { rights: "string", kind: "string", force: "boolean", json: "boolean" },
    gpu: false,
  },
  "assets.build": {
    words: ["assets", "build"],
    flags: { check: "boolean", "no-cache": "boolean", json: "boolean" },
    gpu: false,
  },
  "assets.stills": { words: ["assets", "stills"], flags: { check: "boolean", json: "boolean" }, gpu: true },
  "assets.release-check": { words: ["assets", "release-check"], flags: { json: "boolean" }, gpu: false },
  "assets.export": {
    words: ["assets", "export"],
    positional: ["scene"],
    flags: { out: "string" },
    gpu: false,
    outFlag: "out",
  },
  "assets.index": { words: ["assets", "index"], flags: { json: "boolean" }, gpu: false },
  "assets.missing": { words: ["assets", "missing"], flags: { json: "boolean" }, gpu: false },
  "assets.used-by": { words: ["assets", "used-by"], positional: ["id"], flags: { json: "boolean" }, gpu: false },
  // The fix of the doctor for the Playwright Chromium (doctor.ts).
  "fix.chromium": { program: ["bunx", "playwright", "install", "chromium"], words: [], flags: {}, gpu: false },
  // "Make a Git repository" of the new project wizard, in the new project folder.
  "git.init": { program: ["git", "init"], words: [], flags: {}, gpu: false },
  // "Clone from Git" of the open dialog of the Hub, in the folder that the dialog shows.
  "git.clone": {
    program: ["git", "clone", "--"],
    words: [],
    positional: ["url", "folder"],
    flags: {},
    gpu: false,
    check: (args) => {
      if (typeof args.url !== "string" || !CLONE_URL.test(args.url))
        throw new Error("url must be an HTTPS, SSH or file URL");
      if (typeof args.folder !== "string" || !FOLDER_NAME.test(args.folder))
        throw new Error("folder must be a folder name");
    },
  },
};

const argValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const jobRequestSchema = z.object({
  command: z.string().refine((name) => name in JOB_COMMANDS, "not a job command"),
  args: z.record(z.string(), argValue).default({}),
  /** The work folder: the project folder (absolute), or the parent folder of `create`. */
  cwd: z.string().min(1),
  /** The project key of the job, for the Jobs panel. */
  project: z.string().optional(),
});
export type JobRequest = z.input<typeof jobRequestSchema>;

/** The CLI arguments of a job request. Throws for an unknown argument or a value of the wrong kind. */
export function jobArgv(command: string, args: Readonly<Record<string, unknown>>): string[] {
  const spec = JOB_COMMANDS[command];
  if (spec === undefined) throw new Error(`no job command ${command}`);
  spec.check?.(args);
  const argv = [...spec.words];
  for (const name of spec.positional ?? []) {
    const value = args[name];
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} must be a text or a number`);
    // The program can read a value that starts with "-" as an option.
    if (String(value).startsWith("-")) throw new Error(`${name} must not start with "-"`);
    argv.push(String(value));
  }
  for (const [name, value] of Object.entries(args)) {
    if (spec.positional?.includes(name) === true) continue;
    const kind = spec.flags[name];
    if (kind === undefined) throw new Error(`${command} has no argument ${name}`);
    if (kind === "boolean") {
      if (typeof value !== "boolean") throw new Error(`${name} must be true or false`);
      if (value) argv.push(`--${name}`);
    } else if (kind === "list") {
      if (!Array.isArray(value)) throw new Error(`${name} must be a list`);
      argv.push(`--${name}`, value.map(String).join(","));
    } else {
      if (kind === "number" ? typeof value !== "number" : typeof value !== "string")
        throw new Error(`${name} must be a ${kind}`);
      argv.push(`--${name}`, String(value));
    }
  }
  return argv;
}

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobInfo {
  readonly id: string;
  readonly command: string;
  readonly argv: readonly string[];
  /** The arguments of the request, so the Jobs panel can run the job again. */
  readonly args: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly cwd: string;
  readonly project: string | null;
  readonly gpu: boolean;
  readonly state: JobState;
  readonly exitCode: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** The output files and folders (absolute): the `out` argument, and the paths that a JSON answer names. */
  readonly outputs: readonly string[];
}

export interface JobEvents {
  readonly onState?: (job: JobInfo) => void;
  /** The output text of a job, as it comes. */
  readonly onOutput?: (job: JobInfo, text: string) => void;
}

/** The command line of the `scenity` CLI: the one of the checkout, or the installed one (runtime.ts). */
export function scenityCommand(): string[] {
  return cliCommand();
}

interface Running {
  info: JobInfo;
  readonly log: LogRing;
  child: ChildProcess | null;
  stdout: string;
}

/** The paths that a JSON answer of the CLI names (`out`, `file`, `files`, `dir`): in the work folder, or absolute. */
export function answerPaths(stdout: string, cwd: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    return [];
  }
  const out: string[] = [];
  const visit = (value: unknown, key: string): void => {
    if (typeof value === "string" && ["out", "file", "files", "dir", "path"].includes(key))
      out.push(resolve(cwd, value));
    else if (Array.isArray(value)) for (const item of value) visit(item, key);
    else if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(data, "");
  return [...new Set(out)];
}

/** The job service. */
export class JobService {
  readonly #jobs = new Map<string, Running>();
  #next = 1;

  constructor(
    private readonly events: JobEvents = {},
    private readonly command: () => string[] = scenityCommand,
  ) {}

  list(): JobInfo[] {
    return [...this.#jobs.values()].map((job) => job.info).reverse();
  }

  get(id: string): JobInfo | undefined {
    return this.#jobs.get(id)?.info;
  }

  log(id: string): string[] {
    return this.#jobs.get(id)?.log.lines() ?? [];
  }

  /** Start a job (or queue it behind the running GPU job). Throws for a request that is not valid. */
  start(input: JobRequest): JobInfo {
    const request = jobRequestSchema.parse(input);
    const spec = JOB_COMMANDS[request.command];
    if (spec === undefined) throw new Error(`no job command ${request.command}`);
    const argv = jobArgv(request.command, request.args);
    const outFlag = spec.outFlag === undefined ? undefined : request.args[spec.outFlag];
    const info: JobInfo = {
      id: `job-${String(this.#next++)}`,
      command: request.command,
      argv,
      args: request.args,
      cwd: resolve(request.cwd),
      project: request.project ?? null,
      gpu: spec.gpu,
      state: "queued",
      exitCode: null,
      startedAt: null,
      endedAt: null,
      outputs: typeof outFlag === "string" ? [resolve(request.cwd, outFlag)] : [],
    };
    this.#jobs.set(info.id, { info, log: new LogRing(), child: null, stdout: "" });
    this.#emit(info.id);
    this.#pump();
    return info;
  }

  /** Cancel a job: a queued job ends immediately. A running job gets SIGINT, then SIGTERM, then SIGKILL. */
  cancel(id: string): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || (job.info.state !== "queued" && job.info.state !== "running")) return false;
    if (job.child === null) {
      this.#set(id, { state: "cancelled", endedAt: Date.now() });
      return true;
    }
    const pid = job.child.pid;
    const signal = (name: NodeJS.Signals): void => {
      try {
        if (pid !== undefined) process.kill(-pid, name);
      } catch {
        // The group ended.
      }
    };
    job.info = { ...job.info, state: "cancelled" };
    signal("SIGINT");
    setTimeout(() => signal("SIGTERM"), 3000).unref();
    setTimeout(() => signal("SIGKILL"), 6000).unref();
    return true;
  }

  /** Stop every running job (the host stops). */
  stopAll(): void {
    for (const job of this.#jobs.values()) this.cancel(job.info.id);
  }

  #emit(id: string): void {
    const job = this.#jobs.get(id);
    if (job !== undefined) this.events.onState?.(job.info);
  }

  #set(id: string, change: Partial<JobInfo>): void {
    const job = this.#jobs.get(id);
    if (job === undefined) return;
    job.info = { ...job.info, ...change };
    this.#emit(id);
    if (job.info.state !== "running" && job.info.state !== "queued") this.#pump();
  }

  /** Start the queued jobs that can run: each job with no GPU, and one GPU job when no GPU job runs. */
  #pump(): void {
    const all = [...this.#jobs.values()];
    let gpuBusy = all.some((job) => job.info.gpu && job.info.state === "running");
    for (const job of all) {
      if (job.info.state !== "queued") continue;
      if (job.info.gpu && gpuBusy) continue;
      if (job.info.gpu) gpuBusy = true;
      this.#run(job);
    }
  }

  #run(job: Running): void {
    const spec = JOB_COMMANDS[job.info.command];
    const [cmd, ...rest] = spec?.program ?? this.command();
    const child = spawn(cmd ?? "bun", [...rest, ...job.info.argv], {
      cwd: job.info.cwd,
      env: childEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    this.#set(job.info.id, { state: "running", startedAt: Date.now() });
    const take = (chunk: Buffer, stdout: boolean): void => {
      const text = chunk.toString();
      if (stdout) job.stdout += text;
      job.log.push(text);
      this.events.onOutput?.(job.info, text);
    };
    child.stdout.on("data", (chunk: Buffer) => take(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => take(chunk, false));
    child.on("close", (code) => {
      job.child = null;
      const cancelled = job.info.state === "cancelled";
      const outputs = [...new Set([...job.info.outputs, ...answerPaths(job.stdout, job.info.cwd)])];
      const state: JobState = cancelled ? "cancelled" : code === 0 ? "done" : "failed";
      this.#set(job.info.id, { state, exitCode: code, endedAt: Date.now(), outputs });
    });
  }
}
