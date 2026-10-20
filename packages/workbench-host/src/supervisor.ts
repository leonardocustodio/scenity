// SPDX-License-Identifier: Apache-2.0
/**
 * The supervisor of the host. `main.ts` runs as a small supervisor process that runs
 * the host itself as a worker process (the same main.ts with `SCENITY_WORKBENCH_WORKER=1`):
 *
 * - the first READY line of the worker becomes the READY line of the supervisor (the shell and the tests read it);
 * - a worker that ends with RESTART_EXIT_CODE (`host.restart`) gets a successor on the same port with the same token,
 *   so the page connects again by itself. The successor reads the restart state of the old worker;
 * - SIGTERM and SIGINT go to the worker, and the supervisor ends with the worker;
 * - after the end of a worker, the process groups that it left (children.ts) also end. Thus a worker that a crash or
 *   SIGKILL ended leaves no Vite, terminal or run behind.
 *
 * The worker is a child in the process group of the supervisor, so the shell, which stops the group of the host, stops
 * both. A new worker reloads every module, so a change of the host code by Claude takes effect at the restart.
 *
 * A `WORKBENCH_SIGNAL` line of the worker goes to the stdout of the supervisor (the desktop shell reads it);
 * the other stdout lines go to stderr. A compiled supervisor starts its worker from the binary while the binary
 * is fresh, else from the source files (hostRuntime.ts).
 */
import { realpathSync } from "node:fs";
import { SIGNAL_PREFIX } from "./busy";
import { gitRoot } from "./checkouts";
import { reapStale } from "./children";
import { RESTART_EXIT_CODE } from "./hostProtocol";
import { TOKEN_ENV, formatReadyLine, parseReadyLine, type HostEndpoint } from "./protocol";
import { defaultStateDir } from "./state";
import { SUPERVISED_ENV, WORKER_ENV } from "./supervisorEnv";
import { makeToken } from "./token";
import { isCompiled, workerCommand } from "./hostRuntime";

/** The arguments of the command line (main.ts `parseArgs`). */
export interface SuperviseArgs {
  readonly checkout: string;
  /** The project folder (`--project`), or undefined for the checkout itself. */
  readonly project?: string | undefined;
  readonly port: number;
  readonly stateDir: string | undefined;
}

export interface SuperviseOptions {
  /** The path of main.ts. */
  readonly main: string;
  /** Write the READY line (default: the stdout of the process). */
  readonly ready?: (line: string) => void;
  /** Write a line of the supervisor (default: the stderr of the process). */
  readonly log?: (line: string) => void;
  /** The starts of a successor that can fail before its READY line (a port that the system still holds). */
  readonly retries?: number;
}

/** The arguments of a worker: the checkout, the port, the state folder. */
export function workerArgs(args: SuperviseArgs, port: number): string[] {
  return [
    "--checkout",
    args.checkout,
    ...(args.project === undefined ? [] : ["--project", args.project]),
    "--port",
    String(port),
    ...(args.stateDir === undefined ? [] : ["--state", args.stateDir]),
  ];
}

/** Read the stdout of a worker: give the endpoint of its READY line (or null at the end), then copy the rest to stderr. */
async function readReady(stream: ReadableStream<Uint8Array>): Promise<HostEndpoint | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    text += decoder.decode(value, { stream: true });
    const end = text.indexOf("\n");
    if (end < 0) continue;
    const endpoint = parseReadyLine(text.slice(0, end));
    void drain(reader, text.slice(end + 1));
    return endpoint;
  }
}

/** Give a full stdout line of a worker to its place: a signal line to stdout (the shell), any other line to stderr. */
function forwardLine(line: string): void {
  if (line.startsWith(SIGNAL_PREFIX)) process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

/** Copy the other stdout text of a worker line by line, so the pipe never fills (forwardLine). */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, first: string): Promise<void> {
  const decoder = new TextDecoder();
  let text = first;
  for (;;) {
    const lines = text.split("\n");
    text = lines.pop() ?? "";
    for (const line of lines) forwardLine(line);
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  if (text !== "") forwardLine(text);
}

/**
 * The state folder of the host of the arguments: the folder of its Git worktree, else of the folder itself,
 * or null when the folder does not exist.
 */
async function stateDirOf(args: SuperviseArgs): Promise<string | null> {
  if (args.stateDir !== undefined) return args.stateDir;
  try {
    const folder = realpathSync(args.project ?? args.checkout);
    return defaultStateDir((await gitRoot(folder)) ?? folder);
  } catch {
    return null;
  }
}

/** One worker: its process, its READY endpoint and its exit code. */
async function runWorker(
  options: SuperviseOptions,
  args: SuperviseArgs,
  port: number,
  token: string,
  onStart: (worker: Bun.Subprocess) => void,
): Promise<{ endpoint: HostEndpoint | null; code: number }> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const program = isCompiled() ? workerCommand(log) : [process.execPath, options.main];
  const worker = Bun.spawn([...program, ...workerArgs(args, port)], {
    env: { ...process.env, [TOKEN_ENV]: token, [WORKER_ENV]: "1", [SUPERVISED_ENV]: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  onStart(worker);
  const endpoint = await readReady(worker.stdout);
  if (endpoint !== null) options.ready?.(formatReadyLine(endpoint));
  const code = await worker.exited;
  return { endpoint, code: worker.signalCode === null ? code : 1 };
}

/** Run the host under the supervisor until it ends. Give the exit code of the supervisor. */
export async function supervise(args: SuperviseArgs, options: SuperviseOptions): Promise<number> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const token = makeToken();
  // The signal handlers change this state while a worker runs.
  const life: { current: Bun.Subprocess | null; stopping: boolean; announced: boolean } = {
    current: null,
    stopping: false,
    announced: false,
  };
  const stop = (): void => {
    life.stopping = true;
    life.current?.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let port = args.port;
  let failures = 0;
  for (;;) {
    const ready = (line: string): void => {
      if (!life.announced) (options.ready ?? ((text: string) => process.stdout.write(`${text}\n`)))(line);
      life.announced = true;
    };
    const { endpoint, code } = await runWorker({ ...options, ready }, args, port, token, (worker) => {
      life.current = worker;
    });
    life.current = null;
    if (endpoint !== null) port = Number(new URL(endpoint.origin).port);
    const stateDir = await stateDirOf(args);
    if (stateDir !== null) await reapStale(stateDir);
    if (life.stopping) return code === RESTART_EXIT_CODE ? 0 : code;
    if (code === RESTART_EXIT_CODE) {
      log("workbench host: restart");
      failures = 0;
      continue;
    }
    // A successor that fails before its READY line gets a second try (the port of the old worker).
    if (life.announced && endpoint === null && failures < (options.retries ?? 3)) {
      failures += 1;
      await Bun.sleep(500 * failures);
      continue;
    }
    return code;
  }
}
