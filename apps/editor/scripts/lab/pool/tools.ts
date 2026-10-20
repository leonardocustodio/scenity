// SPDX-License-Identifier: Apache-2.0
/**
 * The shooter of a tool run: a leased page of the running render pool. When no pool runs (or the tool has `--url` or
 * `--local`, or `SCENITY_LABS_POOL=0`), the path without the pool: the GPU lock, a dev server of this checkout and a
 * new browser. The pool takes the GPU lock itself for each lease.
 *
 * `engine: "webkit"` leases the frame of an indexer window of Scenity (WKWebView) from the pool. Without
 * a pool or without a WebKit page the tool uses the WebKit of Playwright, a stand-in for WKWebView, and says so.
 */
import { gpuLock } from "../gpuLock";
import { labServer } from "../server";
import { Shooter, type LabShooter, type ShooterOptions } from "../shooter";
import { findPool } from "./client";
import { NO_WEBKIT_WORKER, PoolRefusal, type PoolEngine } from "./webkit";

export interface ToolShooter {
  readonly shooter: LabShooter;
  /** True when the render pool gives the page. */
  readonly pooled: boolean;
  /** The engine that draws: `chromium`, `webkit (WKWebView of the app)` or `webkit (Playwright)`. */
  readonly engine: string;
  /** End the lease, or close the browser, stop the server and give the GPU lock back. */
  done(): Promise<void>;
}

/** Open the shooter of a tool run on the lab of `options` at a first time and camera. */
export async function openToolShooter(
  options: Omit<ShooterOptions, "origin">,
  first: number,
  camera: string,
  how: {
    readonly url?: string | undefined;
    readonly local?: boolean;
    readonly engine?: PoolEngine;
    readonly log: (text: string) => void;
  },
): Promise<ToolShooter> {
  const engine = how.engine ?? "chromium";
  const pool = how.url === undefined && how.local !== true ? await findPool() : null;
  if (pool !== null) {
    try {
      const shooter = await pool.open({ ...options, origin: pool.origin }, first, camera, engine);
      const name = engine === "webkit" ? "webkit (WKWebView of the app)" : "chromium";
      return { shooter, pooled: true, engine: name, done: () => shooter.close() };
    } catch (error) {
      // No indexer window lends its frame: the WebKit of Playwright is the replacement.
      if (error instanceof PoolRefusal && error.code === NO_WEBKIT_WORKER) {
        how.log(`the render pool has no WebKit page of the app; the WebKit of Playwright stands in`);
      } else if ((await findPool()) !== null) {
        // A refusal of a running pool (a bad spec, a page that did not load) is the error of the tool.
        throw error;
      } else {
        // A pool that stopped while the tool waited for its page: the path without the pool.
        how.log(`the render pool stopped; the tool starts its own browser`);
      }
    }
  }
  const release = await gpuLock({ log: how.log });
  try {
    const server = await labServer(how.url);
    try {
      const shooter = await Shooter.open({ ...options, origin: server.origin }, first, camera, engine);
      return {
        shooter,
        pooled: false,
        engine: engine === "webkit" ? "webkit (Playwright)" : "chromium",
        done: async () => {
          try {
            await shooter.close();
          } finally {
            server.stop();
            release();
          }
        },
      };
    } catch (error) {
      server.stop();
      throw error;
    }
  } catch (error) {
    release();
    throw error;
  }
}
