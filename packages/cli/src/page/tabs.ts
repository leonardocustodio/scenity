// SPDX-License-Identifier: Apache-2.0
/**
 * The player tabs of `scenity shot`, `sheet` and `clip`: a tab is one player page with a spec (pool/target.ts) that a
 * tool seeks, draws and asks. A tab comes from one of two sources:
 *
 * - the scene pool (`scenity pool`): a lease of a warm page of the pool process, which takes the GPU lock per lease;
 * - a local browser of the tool: a page server, a context and a page in headless Chromium, under the GPU lock of the
 *   labs tools for the life of the source.
 *
 * `tabSource` takes the pool when one runs (pool/client.ts), as the lab tools do; `--local` or `SCENITY_SCENE_POOL=0`
 * takes the local browser. Both run the same page code (page/player.ts), so a picture is the same from both.
 */
import type { Browser } from "@playwright/test";
import { findScenePool } from "../pool/client";
import type { PlayerSpec } from "../pool/target";
import { launchChromium } from "./browser";
import { gpuLock } from "./lock";
import { drawnBy, openPlayer, seekPlayer, stableShot, type DrawnBy } from "./player";
import { PLAYER_PAGE, servePlayerPage } from "./serve";

/** One player page of a tool. */
export interface PlayerTab {
  /** True when the page is warm (a pool page that loaded the spec before). */
  readonly warm: boolean;
  /** Set the clock of the player to a time (ms). */
  seek(at: number): Promise<void>;
  /** A screenshot of the player that stays the same (PNG). */
  shot(): Promise<Buffer>;
  drawn(): Promise<DrawnBy>;
  /** Run a function in the page. The function has no outer names: its text goes to the page. */
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  close(): Promise<void>;
}

/** The source of the tabs of one tool run. */
export interface TabSource {
  readonly kind: "pool" | "local";
  open(spec: PlayerSpec): Promise<PlayerTab>;
  close(): Promise<void>;
}

export interface TabSourceOptions {
  /** True: the local browser of the tool, also when a pool runs. */
  readonly local?: boolean;
  /** The GPU lock file of the local browser (default the lock of the labs tools). */
  readonly lock?: string;
  readonly log?: (text: string) => void;
  /** The tool name of the log lines. */
  readonly tool: string;
}

/** The local browser of a tool: the GPU lock, one Chromium, and a server, a context and a page per tab. */
export async function localTabs(options: TabSourceOptions): Promise<TabSource> {
  const release = await gpuLock({
    ...(options.lock === undefined ? {} : { path: options.lock }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  let browser: Browser;
  try {
    browser = await launchChromium();
  } catch (error) {
    release();
    throw error;
  }
  return {
    kind: "local",
    async open(spec) {
      const server = servePlayerPage(spec.out, spec.dir, { ...spec.page, play: false });
      const context = await browser.newContext({
        viewport: { width: spec.width, height: spec.height },
        deviceScaleFactor: 1,
      });
      const close = async () => {
        await context.close();
        server.stop();
      };
      try {
        const page = await context.newPage();
        await openPlayer(page, server.origin + PLAYER_PAGE);
        return {
          warm: false,
          seek: (at) => seekPlayer(page, at),
          shot: () => stableShot(page),
          drawn: () => drawnBy(page),
          evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) =>
            page.evaluate<R, never>(fn as never, arg as never),
          close,
        };
      } catch (error) {
        await close();
        throw error;
      }
    },
    async close() {
      try {
        await browser.close();
      } finally {
        release();
      }
    },
  };
}

/** The variable that disables the scene pool for the tools (`0`). */
export const SCENE_POOL_USE_ENV = "SCENITY_SCENE_POOL";

/** The scene pool when one runs and the options allow it, else the local browser of the tool. */
export async function tabSource(options: TabSourceOptions): Promise<TabSource> {
  const off = options.local === true || process.env[SCENE_POOL_USE_ENV] === "0";
  const pool = off ? null : await findScenePool();
  if (pool !== null) {
    options.log?.(`${options.tool}: the scene pool at ${pool.origin}`);
    return pool.tabs();
  }
  return localTabs(options);
}

/** The tab source options of the options of a tool (`lock`, `local`). */
export function sourceOptions(options: { readonly lock?: string; readonly local?: boolean }) {
  return {
    ...(options.lock === undefined ? {} : { lock: options.lock }),
    ...(options.local === true ? { local: true } : {}),
  };
}
