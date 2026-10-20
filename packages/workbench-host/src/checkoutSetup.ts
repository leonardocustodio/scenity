// SPDX-License-Identifier: Apache-2.0
/**
 * The setup of a new worktree: `bun install --frozen-lockfile`, then
 * `bun run generate` (the token CSS and the API client) in its root. A new worktree has neither, and its lab
 * page does not load without the token CSS. The start screen (`checkouts.create`, as a run of the Runs tab) and the
 * background runs in a new worktree (loops.ts) use the same steps.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { CHECKOUT_SETUP_LINE, CHECKOUT_SETUP_STEPS, type Checkout, type CheckoutSetup } from "./protocol";
import { bunPath } from "./hostRuntime";
import { WEB_DIR } from "./runArgs";
import { spawnRun, type RunExit, type RunManager, type RunProcess, type RunResult, type RunSpawner } from "./runs";

/** The steps of the setup (protocol: the page shows the same command line). */
export const SETUP_STEPS = CHECKOUT_SETUP_STEPS;
export const SETUP_LINE = CHECKOUT_SETUP_LINE;

export interface SetupOptions {
  readonly env: Record<string, string>;
  /**
   * The steps of the setup command of the project manifest (`setupSteps`). The default is `bun install
   * --frozen-lockfile` and `bun run generate`.
   */
  readonly steps?: readonly (readonly string[])[];
  /** The start of the processes (a test gives a fake). */
  readonly spawn?: RunSpawner | undefined;
  /** The program of Bun (default: the Bun of the host). */
  readonly bun?: string;
  readonly onOutput: (stream: "stdout" | "stderr", text: string) => void;
  /** A step ended with exit code 0. */
  readonly onStep?: (step: readonly string[]) => void;
}

/**
 * Start the setup of a checkout as one process of the runs: the steps run one after the other, and the first step
 * that fails ends it with its exit. A signal goes to the step that runs and cancels the next steps.
 */
export function startSetup(checkout: string, options: SetupOptions): RunProcess {
  const spawn = options.spawn ?? spawnRun;
  const bun = options.bun ?? bunPath();
  const cwd = join(checkout, WEB_DIR);
  const live: { child: RunProcess | null; stopped: boolean } = { child: null, stopped: false };
  const steps = options.steps ?? SETUP_STEPS.map((step) => ["bun", ...step]);
  const exited = (async (): Promise<RunExit> => {
    for (const step of steps) {
      if (live.stopped) return { code: null, signal: "SIGINT" };
      options.onOutput("stdout", `$ ${step.join(" ")}\n`);
      // The program `bun` of a step is the Bun of the host.
      const [program = "", ...args] = step;
      live.child = spawn([program === "bun" ? bun : program, ...args], {
        cwd,
        env: options.env,
        onOutput: options.onOutput,
      });
      const exit = await live.child.exited;
      if (exit.code !== 0) return exit;
      options.onStep?.(step);
    }
    return { code: 0, signal: null };
  })();
  return {
    exited,
    signal(signal) {
      live.stopped = true;
      live.child?.signal(signal);
    },
  };
}

/** What the setups of the start screen need of the runs of the host. */
export interface SetupRuns {
  startSetup(checkout: string): { run: string; done: Promise<RunResult> };
}

/**
 * The steps of a setup command line: the commands between `&&`, each an argument list without a shell. A
 * line with another shell character is an error, so the manifest cannot run a shell.
 */
export function setupSteps(line: string): string[][] {
  if (/[|;<>`$(){}\\'"&]/.test(line.replaceAll("&&", ""))) {
    throw new Error(`The setup command of the project has a shell character: ${line}`);
  }
  const steps = line.split("&&").map((part) =>
    part
      .trim()
      .split(/\s+/)
      .filter((word) => word !== ""),
  );
  if (steps.some((step) => step.length === 0))
    throw new Error(`The setup command of the project is not valid: ${line}`);
  return steps;
}

/**
 * The setups as runs of the host (`setup`), with the spawner of the runs. `setup` gives the setup command of
 * the project manifest (null: the default steps).
 */
export function setupRunsOf(
  runs: Pick<RunManager, "startHostRun" | "spawner">,
  setup: () => string | null = () => null,
): SetupRuns {
  return {
    startSetup: (path) => {
      const line = setup();
      const steps = line === null ? undefined : setupSteps(line);
      return runs.startHostRun(path, "setup", (onOutput, env) =>
        startSetup(path, { env, spawn: runs.spawner, onOutput, ...(steps === undefined ? {} : { steps }) }),
      );
    },
  };
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The setups of the worktrees that the start screen made. A checkout is `preparing` while its setup runs and
 * `failed` after a setup that failed. After a setup that passed, it has no `setup` field.
 */
export class CheckoutSetups {
  readonly #runs: SetupRuns;
  readonly #states = new Map<string, CheckoutSetup>();

  constructor(runs: SetupRuns) {
    this.#runs = runs;
  }

  /** Start the setup of a new checkout. The promise ends with the setup. */
  start(path: string): { setup: CheckoutSetup; done: Promise<CheckoutSetup | null> } {
    const key = realPath(path);
    const { run, done } = this.#runs.startSetup(path);
    const setup: CheckoutSetup = { state: "preparing", run };
    this.#states.set(key, setup);
    const end = done.then((result) => {
      if (this.#states.get(key)?.run !== run) return this.#states.get(key) ?? null;
      if (result.status === "passed") {
        this.#states.delete(key);
        return null;
      }
      const failed: CheckoutSetup = { state: "failed", run };
      this.#states.set(key, failed);
      return failed;
    });
    return { setup, done: end };
  }

  /** The setup state of a checkout, or null for a ready checkout. */
  of(path: string): CheckoutSetup | null {
    return this.#states.get(realPath(path)) ?? null;
  }

  /** The checkout with its setup state. */
  decorate(checkout: Checkout): Checkout {
    const setup = this.of(checkout.path);
    return setup === null ? checkout : { ...checkout, setup };
  }

  /** Throw an error while the setup of the checkout runs: its dev servers cannot start yet. */
  assertReady(path: string): void {
    const setup = this.of(path);
    if (setup?.state !== "preparing") return;
    throw new Error(
      `The checkout is still preparing (${SETUP_LINE}, run ${setup.run}). Open it when the setup run ends.`,
    );
  }
}
