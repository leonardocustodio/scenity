// SPDX-License-Identifier: Apache-2.0
/**
 * The client of the scene pool. `findScenePool()` reads `pool.json` and the token of the pool folder and asks the pool
 * for its health; without a running pool it gives null, and the tool opens its local browser (page/tabs.ts). A tab of
 * the pool is a lease of a warm page: the pool seeks, draws and runs the scripts of the tool on its page, and a picture
 * returns in the picture form of the lab pool (`poolWire`).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, readPool, type PoolInfo } from "./files";
import { unpackPicture } from "@scenity/labs-platform/poolWire";
import type { DrawnBy } from "../page/player";
import type { PlayerTab, TabSource } from "../page/tabs";
import type { PlayerSpec } from "./target";

/** The variable with another folder of the scene pool. */
export const SCENE_POOL_DIR_ENV = "SCENITY_SCENE_POOL_DIR";
/** The path prefix of the HTTP API of the pool. */
export const SCENE_POOL_PREFIX = "/__pool/";
/** The longest wait for the health answer of a pool (ms). */
const HEALTH_MS = 1_000;

/** The folder of the scene pool: the variable, else `scenity-scene-pool` in the temp folder of the user. */
export function scenePoolDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const given = env[SCENE_POOL_DIR_ENV];
  return given !== undefined && given !== "" ? given : join(tmpdir(), "scenity-scene-pool");
}

/** What the pool says of a lease. */
export interface LeaseAnswer {
  readonly lease: string;
  readonly warm: boolean;
  readonly lockMs: number;
  readonly openMs: number;
}

export class ScenePoolClient {
  constructor(
    readonly info: PoolInfo,
    private readonly token: string,
  ) {}

  get origin(): string {
    return this.info.origin;
  }

  /** A request to the API; throw with the error text of the pool on a status other than 200. */
  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.origin}${SCENE_POOL_PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // A lease waits for the GPU lock as long as a tool waits for it: no time limit of the fetch of Bun.
      timeout: false,
    });
    if (response.ok) return response;
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // A text answer.
    }
    throw new Error(`The scene pool refused ${method} ${path}: ${message}`);
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.request(method, path, body)).json()) as T;
  }

  /** Lease a warm page of a spec. */
  async open(spec: PlayerSpec): Promise<PlayerTab> {
    const answer = await this.json<LeaseAnswer>("POST", "lease", { spec });
    const path = `lease/${answer.lease}`;
    return {
      warm: answer.warm,
      seek: async (at) => {
        await this.json("POST", `${path}/seek`, { at });
      },
      shot: async () => {
        const body = new Uint8Array(await (await this.request("POST", `${path}/shot`, {})).arrayBuffer());
        return unpackPicture(body).bytes;
      },
      drawn: () => this.json<DrawnBy>("POST", `${path}/drawn`, {}),
      evaluate: async <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => {
        const answer = await this.json<{ value: R }>("POST", `${path}/evaluate`, { source: fn.toString(), arg });
        return answer.value;
      },
      close: async () => {
        await this.request("DELETE", path);
      },
    };
  }

  /** The tab source of a tool run: the pool takes the GPU lock per lease, so the source holds nothing. */
  tabs(): TabSource {
    return { kind: "pool", open: (spec) => this.open(spec), close: () => Promise.resolve() };
  }
}

/** The running scene pool of a folder (default `scenePoolDir()`), or null. */
export async function findScenePool(dir: string = scenePoolDir()): Promise<ScenePoolClient | null> {
  const pool = readPool(dir);
  if (pool === null || !alive(pool.info.pid)) return null;
  try {
    const health = await fetch(`${pool.info.origin}${SCENE_POOL_PREFIX}health`, {
      signal: AbortSignal.timeout(HEALTH_MS),
    });
    const body = (await health.json()) as { ok?: unknown; kind?: unknown };
    return body.ok === true && body.kind === "scene" ? new ScenePoolClient(pool.info, pool.token) : null;
  } catch {
    return null;
  }
}
