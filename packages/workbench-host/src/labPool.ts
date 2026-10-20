// SPDX-License-Identifier: Apache-2.0
/**
 * The render pool and the built lab of a checkout. The pool starts with the host. The pool is a child process of the
 * host from the checkout (`apps/editor/scripts/lab/pool/main.ts`; the host does not import apps/editor). It builds
 * the lab and serves the build on a free port behind the sign-in gate of the lab page (a new per-process secret). It
 * builds the lab again after a change of the sources, and keeps warm lab pages for the tools. The host runs it as a
 * `DevServer` (a process group, the readiness poll, a restart after a crash).
 *
 * The surfaces that need no HMR use the built lab (surfaces.ts): the shadow frame always when the built lab is ready,
 * the visible lab frame only when the setting of the checkout says so (`builtLab`: a window where the owner does not
 * edit). `fresh()` asks the pool for the build of the current sources, so a shadow never shows an old build.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LAB_KEY_ENV, newLabKey } from "@scenity/labs-platform/labKey";
import { bunPath } from "./hostRuntime";
import { childEnv, DevServer, LAB_APP, labRoot, type CommandFactory, type DevServerOptions } from "./servers";

/** The variable with the pool folder for the tools (apps/editor/scripts/lab/pool/paths.ts). */
export const POOL_DIR_ENV = "SCENITY_LABS_POOL_DIR";
/** The variable with the token of the API of the pool (apps/editor/scripts/lab/pool/main.ts). */
export const POOL_TOKEN_ENV = "SCENITY_LABS_POOL_TOKEN";
/**
 * The variable with the token of the WebKit worker paths of the pool (apps/editor/scripts/lab/pool/webkitApi.ts).
 * The indexer window of the app gets the same token (`SurfaceState.indexerWorker`) and lends its frame to the pool.
 */
export const POOL_WORKER_TOKEN_ENV = "SCENITY_LABS_POOL_WORKER_TOKEN";
/** The pages of the pool that the host starts (each page is a warm lab: about 0.3–0.5 GB). */
export const HOST_POOL_PAGES = 2;
/** The longest wait for the build of the current sources (ms): a build takes about 1.5 s. */
const FRESH_TIMEOUT_MS = 30_000;

/** The script of the pool process in a checkout. */
export function poolScript(checkout: string): string {
  return join(labRoot(checkout), LAB_APP, "scripts/lab/pool/main.ts");
}

/** The pool process of a checkout on a port: its folder under the state folder, its secret and its token. */
export function poolCommand(
  stateDir: (checkout: string) => string,
  token: string,
  pages = HOST_POOL_PAGES,
  workerToken: string | null = null,
): CommandFactory {
  return (checkout, port) => ({
    cmd: [
      bunPath(),
      poolScript(checkout),
      "--port",
      String(port),
      "--pages",
      String(pages),
      "--state",
      stateDir(checkout),
    ],
    cwd: join(labRoot(checkout), LAB_APP),
    env: childEnv({
      [LAB_KEY_ENV]: newLabKey(),
      [POOL_TOKEN_ENV]: token,
      ...(workerToken === null ? {} : { [POOL_WORKER_TOKEN_ENV]: workerToken }),
    }),
  });
}

/** What a surface needs of the built lab of its checkout. */
export interface BuiltLabRef {
  /** The pool process: its origin, its state and the secret of its lab page. */
  readonly server: DevServer;
  /** The ID of the build of the current sources (it waits for a build after a change), or null without one. */
  fresh(): Promise<string | null>;
  /** True when the visible lab frame also uses the built lab (the setting `builtLab` of the checkout). */
  visible(): boolean;
  /** The token of the WebKit worker paths of the pool, or absent (no worker paths). */
  readonly workerToken?: string;
}

/** The pool of one checkout. */
export class LabPool implements BuiltLabRef {
  readonly server: DevServer;
  readonly #token = randomBytes(32).toString("hex");
  readonly workerToken = randomBytes(32).toString("hex");
  readonly #visible: () => boolean;

  constructor(
    checkout: string,
    options: {
      readonly stateDir: (checkout: string) => string;
      readonly pages?: number;
      readonly visible: () => boolean;
      readonly command?: (token: string) => CommandFactory;
      readonly devServer?: Pick<DevServerOptions, "autoRestarts" | "backoffMs" | "pollMs" | "readyTimeoutMs">;
    },
  ) {
    const command =
      options.command?.(this.#token) ??
      poolCommand(options.stateDir, this.#token, options.pages ?? HOST_POOL_PAGES, this.workerToken);
    // The first build takes about 1.5 s; the root answers 200 when a build is there.
    // A short poll: a stop of the host waits for a start in progress to see the stop.
    this.server = new DevServer({
      checkout,
      kind: "render pool",
      command,
      readyPath: "/",
      pollMs: 100,
      ...options.devServer,
    });
    this.#visible = options.visible;
  }

  visible(): boolean {
    return this.#visible();
  }

  async fresh(): Promise<string | null> {
    const origin = this.server.info.status === "ready" ? this.server.info.origin : null;
    if (origin === null) return null;
    try {
      const response = await fetch(`${origin}/__pool/build`, {
        headers: { authorization: `Bearer ${this.#token}` },
        signal: AbortSignal.timeout(FRESH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const build = (await response.json()) as { id?: unknown };
      return typeof build.id === "number" ? String(build.id) : null;
    } catch {
      return null;
    }
  }
}

/** The pools of the host, one per checkout; none when the host runs without them (the tests). */
export class LabPools {
  readonly #pools = new Map<string, LabPool>();
  readonly #make: ((checkout: string) => LabPool) | null;
  #stopped = false;

  constructor(make: ((checkout: string) => LabPool) | null) {
    this.#make = make;
  }

  /**
   * The pool of a checkout (the first call makes it, stopped), or null without pools or for a checkout without the
   * pool script (an old worktree).
   */
  ensure(checkout: string): LabPool | null {
    if (this.#make === null || !existsSync(poolScript(checkout))) return null;
    let pool = this.#pools.get(checkout);
    if (pool === undefined) {
      pool = this.#make(checkout);
      this.#pools.set(checkout, pool);
    }
    return pool;
  }

  /**
   * Start the pool of the open checkout and stop the others (one Chromium of pool pages per host). After `stopAll`
   * (a stop or a suspension of the host) it starts nothing until `resume`.
   */
  async only(checkout: string): Promise<void> {
    if (this.#stopped) return;
    const keep = this.ensure(checkout);
    await Promise.all([...this.#pools.values()].filter((pool) => pool !== keep).map((pool) => pool.server.stop()));
    // A stop can come while the other pools stop.
    if (!this.stopped) await keep?.server.start();
  }

  /** True after `stopAll` until `resume`. */
  get stopped(): boolean {
    return this.#stopped;
  }

  /** Let `only` start pools again (the open of a checkout after a suspension of the host). */
  resume(): void {
    this.#stopped = false;
  }

  async stopAll(): Promise<void> {
    this.#stopped = true;
    await Promise.all([...this.#pools.values()].map((pool) => pool.server.stop()));
  }

  killAllNow(): void {
    this.#stopped = true;
    for (const pool of this.#pools.values()) pool.server.killNow();
  }
}
