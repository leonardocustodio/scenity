// SPDX-License-Identifier: Apache-2.0
/**
 * The command line of the workbench host:
 *
 *   bun packages/workbench-host/src/main.ts --checkout <abs path> | --project <abs path> [--port <n>] [--state <dir>]
 *
 * `--project` names a project folder with `scenity.project.json` (a folder without the file gets the built-in
 * manifest of this repository). The checkout is then the project folder. With both flags, the project folder is a
 * folder of the checkout. The folder needs no Git. `SCENITY_WORKBENCH_ROLES` gives role tokens.
 * The checkout can be a workspace folder below the Git top folder (workspace.ts).
 *
 * The first stdout line is `WORKBENCH_READY {"origin":…,"token":…}`. The host writes its other text to stderr, but
 * for the desktop shell (`SCENITY_WORKBENCH_SIGNALS=1`) it also writes `WORKBENCH_SIGNAL {"busy":…}` lines to stdout
 * (busy.ts).
 * SIGTERM and SIGINT stop the host and every child process. The process is a supervisor (supervisor.ts) that
 * runs the host as a worker process, so `host.restart` can start a new host on the same port with the same token.
 */
import { isAbsolute } from "node:path";
import { authFromEnv } from "./authProvider";
import { formatSignal, SIGNALS_ENV } from "./busy";
import { shellWebp } from "./shellWebp";
import { startHost, type Host } from "./host";
import { RESTART_EXIT_CODE } from "./hostProtocol";
import { formatReadyLine } from "./protocol";
import { supervise } from "./supervisor";
import { SUPERVISED_ENV, WORKER_ENV } from "./supervisorEnv";
import { remoteSetup } from "./remote";

export interface CliArgs {
  readonly checkout: string;
  /** The project folder, or undefined (the checkout is the project folder). */
  readonly project: string | undefined;
  readonly port: number;
  readonly stateDir: string | undefined;
}

const USAGE =
  "Usage: bun packages/workbench-host/src/main.ts --checkout <abs path> | --project <abs path> [--port <n>] [--state <dir>]";

function flagValues(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const match = /^--(checkout|project|port|state)(?:=(.*))?$/.exec(arg);
    if (match === null) throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    const value = match[2] ?? argv[(index += 1)];
    if (value === undefined || value === "") throw new Error(`The flag --${match[1] ?? ""} needs a value.\n${USAGE}`);
    values.set(match[1] ?? "", value);
  }
  return values;
}

/** Read the arguments of the command line. Throw an error with the usage text for bad arguments. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const values = flagValues(argv);
  const project = values.get("project");
  if (project !== undefined && !isAbsolute(project)) throw new Error(`--project needs an absolute path.\n${USAGE}`);
  const checkout = values.get("checkout") ?? project;
  if (checkout === undefined || !isAbsolute(checkout)) throw new Error(`--checkout needs an absolute path.\n${USAGE}`);
  const port = Number(values.get("port") ?? "0");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port needs 0 to 65535.\n${USAGE}`);
  return { checkout, project, port, stateDir: values.get("state") };
}

/** Stop the host on SIGTERM and SIGINT, and end the children when the process exits. */
function handleSignals(host: Host): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    // The children get SIGKILL after their grace time (servers.ts). This timer is the last limit.
    setTimeout(() => process.exit(1), 10_000).unref();
    host.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("exit", () => host.killNow());
}

/** The host itself (the worker of the supervisor). */
async function runHost(args: CliArgs): Promise<void> {
  let host: Host | null = null;
  // Under the supervisor, `host.restart` stops the host and ends with RESTART_EXIT_CODE.
  const restart =
    process.env[SUPERVISED_ENV] === "1"
      ? () => {
          setTimeout(() => process.exit(RESTART_EXIT_CODE), 10_000).unref();
          void (host?.stop() ?? Promise.resolve()).finally(() => process.exit(RESTART_EXIT_CODE));
        }
      : undefined;
  // The busy state for the desktop shell, only when the shell asks for it.
  const onBusy =
    process.env[SIGNALS_ENV] === "1"
      ? (busy: boolean) => void process.stdout.write(`${formatSignal({ busy })}\n`)
      : undefined;
  // The shell re-encodes the saved JPEG pictures as WebP, only when it asks for it.
  const onJpeg = shellWebp(process.env);
  // The host behind the gateway in a container (remote.ts).
  const remote = remoteSetup(process.env);
  host = await startHost({
    checkout: args.checkout,
    ...(args.project === undefined ? {} : { project: args.project }),
    port: args.port,
    stateDir: args.stateDir,
    ...(onJpeg === undefined ? {} : { onJpeg }),
    // The auth provider of the environment: `token` with role tokens, else `none`.
    auth: authFromEnv(process.env),
    // The render pool and the built lab start with the host. The remote mode (remote.ts) has
    // no pool: the server has no GPU, and the frames draw in the browser of the person.
    pool: remote === null ? {} : null,
    remote,
    ...(restart === undefined ? {} : { restart }),
    ...(onBusy === undefined ? {} : { onBusy }),
  });
  process.stdout.write(`${formatReadyLine(host.endpoint)}\n`);
  handleSignals(host);
  process.stderr.write(
    `workbench host: ${host.endpoint.origin}, checkout ${host.current()}, state ${host.state.dir}\n`,
  );
}

/** The supervisor runs the host as a worker; the worker runs the host. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.env[WORKER_ENV] === "1") {
    await runHost(args);
    return;
  }
  process.exit(await supervise(args, { main: import.meta.path }));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}
