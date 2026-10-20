// SPDX-License-Identifier: Apache-2.0
/**
 * The runs of the commands of the project. A run is the command line of a run of the project (runCatalog.ts) with
 * its arguments, in the project folder of the checkout, with an argument list and no shell. Its output goes to the
 * pages as `runs.output`. At the end, `runs.done` gives the exit code, the summary (the last lines), the output folder
 * and its images. One run that renders WebGL at a time per checkout (the lab tools also take the GPU lock themselves). A
 * cancel sends SIGINT to the process group, then SIGTERM, then SIGKILL.
 *
 * `startRun` gives a promise of the result, so the `workbench_run` tool waits for the run.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { childGroups } from "./children";
import { isDenied } from "./denylist";
import { listImages, planRun, printedFolder, summarize, WEB_DIR, type RunPlan } from "./runArgs";
import type { RunCatalog } from "./runCatalog";
import {
  runOfFilePath,
  type HostEvent,
  type HostRunCommand,
  type RunCommand,
  type RunInfo,
  type RunStatus,
} from "./protocol";
import { OutputBatch } from "./runOutput";
import { childEnv, LogRing } from "./servers";

/** The end of a process. */
export interface RunExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** A started process of a run. */
export interface RunProcess {
  readonly exited: Promise<RunExit>;
  /** Send a signal to the process group. */
  signal(signal: NodeJS.Signals): void;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  onOutput(stream: "stdout" | "stderr", text: string): void;
}

/** Start a process (a test gives a fake). */
export type RunSpawner = (argv: readonly string[], options: SpawnOptions) => RunProcess;

/** The default spawner: a process group of its own, stdin closed, the output as UTF-8 text. */
export const spawnRun: RunSpawner = (argv, options) => {
  const [program = "", ...args] = argv;
  const child = spawn(program, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The group goes into children.json until the run ends.
  childGroups.add(child.pid, "run", program);
  child.once("exit", () => childGroups.remove(child.pid));
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => options.onOutput("stdout", text));
  child.stderr.on("data", (text: string) => options.onOutput("stderr", text));
  const exited = new Promise<RunExit>((done) => {
    child.on("error", (error) => {
      options.onOutput("stderr", `${error.message}\n`);
      done({ code: null, signal: null });
    });
    child.on("close", (code, signal) => done({ code, signal }));
  });
  return {
    exited,
    signal(signal) {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group ended already.
      }
    },
  };
};

/** The result of a run that ended. */
export type RunResult = Required<Omit<RunInfo, "output" | "line">> & Pick<RunInfo, "line">;

/** The start of the process of a host run (`setup`): it gets the output callback and the environment of a run. */
export type HostRunStart = (
  onOutput: (stream: "stdout" | "stderr", text: string) => void,
  env: Record<string, string>,
) => RunProcess;

function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export interface StartOptions {
  /** The owner confirmed a `promote` without `--dry`. */
  readonly confirm?: boolean;
  /** The commit for `review --ref`. */
  readonly ref?: string | null;
  /** Each part of the output, also for the caller (the tool). */
  onOutput?(stream: "stdout" | "stderr", text: string): void;
}

export interface RunManagerOptions {
  emit(event: HostEvent): void;
  readonly spawn?: RunSpawner;
  /** The wait after SIGINT and after SIGTERM (default 3 s each). */
  readonly graceMs?: number;
  /** The count of runs that the host keeps (default 30). */
  readonly keep?: number;
  readonly now?: () => Date;
  /** The longest wait of a chunk of output before its `runs.output` event (ms; default 16; 0 sends immediately). */
  readonly outputBatchMs?: number;
  /** The runs of the open project (default: the catalog of the open project, runCatalog.ts). */
  readonly catalog?: () => RunCatalog;
  /** The project folder relative to each checkout (default: the checkout itself). */
  readonly projectRel?: () => string;
}

interface RunEntry {
  info: RunInfo;
  readonly log: LogRing;
  readonly process: RunProcess;
  readonly done: Promise<RunResult>;
  cancelled: boolean;
}

/** The runs of one host. */
export class RunManager {
  readonly #options: RunManagerOptions;
  readonly #runs = new Map<string, RunEntry>();

  constructor(options: RunManagerOptions) {
    this.#options = options;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  /** The start of the processes of the runs (a test gives a fake). */
  get spawner(): RunSpawner {
    return this.#options.spawn ?? spawnRun;
  }

  /** Start a run and give its ID and the promise of its result. Throw for a bad command or a busy GPU. */
  start(
    checkout: string,
    command: string,
    args: readonly unknown[],
    options: StartOptions = {},
  ): { run: string; done: Promise<RunResult> } {
    const run = newRunId();
    const plan = planRun(checkout, command, args, {
      runId: run,
      confirm: options.confirm === true,
      ref: options.ref ?? null,
      ...(this.#options.catalog === undefined ? {} : { catalog: this.#options.catalog() }),
      ...(this.#options.projectRel === undefined ? {} : { projectRel: this.#options.projectRel() }),
    });
    if (plan.gpu) {
      const busy = [...this.#runs.values()].find(
        (entry) => entry.info.status === "running" && entry.info.gpu && entry.info.checkout === checkout,
      );
      if (busy !== undefined) {
        throw new Error(
          `A WebGL run is running in this checkout: ${busy.info.command} (${busy.info.run}). Wait for it or cancel it.`,
        );
      }
    }
    return { run, done: this.#launch(checkout, command, run, plan, options) };
  }

  /**
   * Start a run of the host itself (the setup of a new worktree, checkoutSetup.ts, or the import job of a dropped
   * file, imports.ts): no run of the project and no GPU wait of the host. Its output goes to the pages as the output
   * of a run, so the Runs tab shows it.
   */
  startHostRun(
    checkout: string,
    command: HostRunCommand,
    start: HostRunStart,
  ): { run: string; done: Promise<RunResult> } {
    const run = newRunId();
    const plan: RunPlan = { argv: [], args: [], cwd: join(checkout, WEB_DIR), outDir: null, gpu: false, line: "" };
    return { run, done: this.#launch(checkout, command, run, plan, {}, start) };
  }

  /**
   * Show a run of an old host as ended (the restart of the host): the status `cancelled`, the restart words as
   * its output and its summary. Its process ended with the old host.
   */
  addEnded(old: RunInfo, text: string): void {
    const log = new LogRing(20);
    log.line(text);
    const info: RunInfo = { ...old, status: "cancelled", ended: old.ended ?? this.#now(), summary: text };
    const exit: RunExit = { code: null, signal: null };
    const process: RunProcess = { exited: Promise.resolve(exit), signal: () => undefined };
    const result: RunResult = { ...info };
    this.#runs.set(old.run, { info, log, process, done: Promise.resolve(result), cancelled: true });
    this.#options.emit({ type: "runs.done", run: old.run, code: null, summary: text, outDir: info.outDir, images: [] });
  }

  /** The runs that run at this time. */
  runningAll(): RunInfo[] {
    return [...this.#runs.values()].filter((entry) => entry.info.status === "running").map((entry) => entry.info);
  }

  /** Start a run and wait for its result (the `workbench_run` tool). */
  startRun(
    checkout: string,
    command: string,
    args: readonly unknown[],
    options: StartOptions = {},
  ): Promise<RunResult> {
    return this.start(checkout, command, args, options).done;
  }

  #launch(
    checkout: string,
    command: RunCommand,
    run: string,
    plan: RunPlan,
    options: StartOptions,
    start: HostRunStart | null = null,
  ): Promise<RunResult> {
    const log = new LogRing(2000);
    // The chunks of one stream go to the pages as one `runs.output` event per OUTPUT_BATCH_MS.
    const batch = new OutputBatch(
      (stream, data) => this.#options.emit({ type: "runs.output", run, stream, data }),
      this.#options.outputBatchMs,
    );
    const emit = (stream: "stdout" | "stderr", data: string): void => {
      log.push(data);
      options.onOutput?.(stream, data);
      batch.push(stream, data);
    };
    const info: RunInfo = {
      run,
      command,
      ...(plan.line === "" ? {} : { line: plan.line }),
      args: plan.args,
      checkout,
      status: "running",
      code: null,
      started: this.#now(),
      ended: null,
      gpu: plan.gpu,
      summary: "",
      outDir: plan.outDir,
      images: [],
    };
    const env = childEnv({ NO_COLOR: "1", FORCE_COLOR: "0" });
    const child =
      start === null
        ? (this.#options.spawn ?? spawnRun)(plan.argv, { cwd: plan.cwd, env, onOutput: emit })
        : start(emit, env);
    let finish: (result: RunResult) => void = () => undefined;
    const done = new Promise<RunResult>((resolve) => (finish = resolve));
    const entry: RunEntry = { info, log, process: child, done, cancelled: false };
    this.#runs.set(run, entry);
    this.#trim();
    if (start === null) emit("stdout", `$ ${[plan.line, ...plan.args].join(" ")}\n`);
    void child.exited.then((exit) => {
      // The last output goes to the pages before `runs.done`.
      batch.flush();
      finish(this.#finish(entry, plan, exit));
    });
    return done;
  }

  #finish(entry: RunEntry, plan: RunPlan, exit: RunExit): RunResult {
    const output = entry.log.lines().join("\n");
    const outDir = plan.outDir ?? printedFolder(output, plan.cwd);
    const images = outDir === null ? [] : listImages(outDir);
    const status: RunStatus = entry.cancelled ? "cancelled" : exit.code === 0 ? "passed" : "failed";
    const summary = summarize(output);
    entry.info = { ...entry.info, status, code: exit.code, ended: this.#now(), summary, outDir, images };
    const { run, code } = entry.info;
    this.#options.emit({ type: "runs.done", run, code, summary, outDir, images: [...images] });
    return { ...entry.info, args: [...entry.info.args], images: [...images] };
  }

  /** Forget the oldest runs that ended, over the limit. */
  #trim(): void {
    const keep = this.#options.keep ?? 30;
    const ended = [...this.#runs.values()].filter((entry) => entry.info.status !== "running");
    for (const entry of ended.slice(0, Math.max(0, this.#runs.size - keep))) this.#runs.delete(entry.info.run);
  }

  /** Stop a run: SIGINT, SIGTERM after the grace time, SIGKILL after a second grace time. */
  async cancel(run: string): Promise<void> {
    const entry = this.#runs.get(run);
    if (entry === undefined) throw new Error(`No run ${run}.`);
    if (entry.info.status !== "running") return;
    entry.cancelled = true;
    const grace = this.#options.graceMs ?? 3000;
    const end = { done: false };
    void entry.done.then(() => (end.done = true));
    for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
      if (end.done) return;
      entry.process.signal(signal);
      await Promise.race([entry.done, new Promise((wait) => setTimeout(wait, grace))]);
    }
  }

  /** Stop every run that runs (the stop of the host). */
  async cancelAll(): Promise<void> {
    await Promise.all([...this.#runs.keys()].map((run) => this.cancel(run)));
  }

  /** Send SIGKILL to every run immediately (the exit of the process). */
  killNow(): void {
    for (const entry of this.#runs.values()) if (entry.info.status === "running") entry.process.signal("SIGKILL");
  }

  /** The runs, the newest first, with the last lines of their output. */
  list(lines = 300): RunInfo[] {
    return [...this.#runs.values()].reverse().map((entry) => ({ ...entry.info, output: entry.log.tail(lines) }));
  }

  /** The state of one run, or null. */
  info(run: string): RunInfo | null {
    return this.#runs.get(run)?.info ?? null;
  }

  /** The running run of a checkout, or null. */
  running(checkout: string): RunInfo | null {
    const entry = [...this.#runs.values()].find(
      (item) => item.info.status === "running" && item.info.checkout === checkout,
    );
    return entry?.info ?? null;
  }

  /**
   * The absolute path of a file of the output folder of a run, or null: the path must be in that folder after the
   * links are resolved, and it must be a file.
   */
  fileOf(run: string, path: string): string | null {
    const outDir = this.#runs.get(run)?.info.outDir ?? null;
    if (outDir === null) return null;
    try {
      const root = realpathSync(outDir);
      const full = realpathSync(isAbsolute(path) ? path : resolve(outDir, path));
      const near = relative(root, full);
      if (near === "" || near.startsWith("..") || isAbsolute(near)) return null;
      // A file of the denylist never leaves the host, also from an output folder.
      if (isDenied(near) || isDenied(full)) return null;
      return statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }
}

const TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
};

/**
 * The HTTP route of the run files: `GET /runs/<run>/file?path=<path>` gives a file of the output folder of that run.
 * The server checks the token first (server.ts). Another path gives null.
 */
export function runFilesHttp(runs: RunManager): (request: Request, url: URL) => Response | null {
  return (request, url) => {
    const run = runOfFilePath(url.pathname);
    if (run === null || request.method !== "GET") return null;
    const file = runs.fileOf(run, url.searchParams.get("path") ?? "");
    if (file === null) return new Response("No such file in the output folder of the run.", { status: 404 });
    const type = TYPES[(/\.[^./]+$/.exec(file)?.[0] ?? "").toLowerCase()] ?? "application/octet-stream";
    return new Response(Bun.file(file), { headers: { "content-type": type, "cache-control": "no-store" } });
  };
}
