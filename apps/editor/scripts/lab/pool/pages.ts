// SPDX-License-Identifier: Apache-2.0
/**
 * The warm lab pages of the render pool: one Chromium of the tools (`launchShooterBrowser`: the same flags as the
 * `Shooter`) and N pages on the built lab.
 *
 * A lease gives a tool one page with the lab of a page spec (the take, the events, the tier, the size and the other
 * options of `ShooterOptions`, but not the time and not the camera, which each shot sets). A free page with the same spec
 * and the current build is warm: the lease needs no page load. Else the pool loads the lab into the free page that
 * waited longest. A lease that ran a script in the page (`evaluate`: a take, events or tunes changed) leaves the page
 * cold, and the pool loads it again in the background.
 *
 * The pool takes the GPU lock of the machine while a lease runs (one lock for every lease of the moment), not for its
 * life, so other tools and pages can draw between the jobs. A page without a lease is frozen (the web lifecycle
 * state of Chromium): it draws nothing and keeps its decoded assets.
 *
 * The slots, the queue, the shared lock and the lifecycle are the generic warm pages of
 * `@scenity/labs-platform/warmPages`. The scene pool of `scenity pool` uses them too. This file gives the lab target.
 */
import type { Browser, Page } from "@playwright/test";
import { stableJson } from "@scenity/labs-platform/frameKey";
import { WarmPages, type WarmLease } from "@scenity/labs-platform/warmPages";
import {
  launchShooterBrowser,
  loadLab,
  Shooter,
  shooterPageOptions,
  type LabShooter,
  type ShooterOptions,
} from "../shooter";
import type { BuildInfo } from "./builtLab";

/** The lab of a page: the options of a shooter without the origin. */
export type PageSpec = Omit<ShooterOptions, "origin" | "labPath">;

/**
 * The spec of the warm page at the start: the defaults of `labs shot`. The take is the default take of the
 * project (`projectDefaultTake`). An empty take is the lab with no take.
 */
export function defaultSpec(take = ""): PageSpec {
  return { take, tier: "high", worker: false, assets: true, width: 1280, height: 800 };
}

/** The key of a spec: the same lab in the same page size. */
export function specKey(spec: PageSpec): string {
  return stableJson({ ...spec, rec: spec.rec ?? null, debug: spec.debug ?? null, source: spec.source ?? null });
}

/** One lease of a page. */
export interface Lease extends WarmLease {
  /** A `Shooter` on a Chromium page, or a `WebKitShooter` on the frame of an indexer window. */
  readonly shooter: LabShooter;
  /** The PNG of the shots of the lease by ID, for a sheet or a WebP frame without a second transfer. */
  readonly shots: Map<string, Buffer>;
}

export interface PagePoolOptions {
  readonly origin: string;
  readonly pages: number;
  /** The build of the current sources (`BuiltLab.ensure`). */
  readonly build: () => Promise<BuildInfo>;
  /** Take the GPU lock; give the release function. */
  readonly lock: () => Promise<() => void>;
  readonly launch?: () => Promise<Browser>;
  readonly log?: (line: string) => void;
}

/** The time and the camera of a page that loads. */
interface LoadHint {
  readonly at: number;
  readonly camera: string;
}

export class PagePool {
  readonly #pages: WarmPages<PageSpec, Page, LoadHint, Lease>;

  constructor(options: PagePoolOptions) {
    const { origin } = options;
    const launch = options.launch ?? launchShooterBrowser;
    this.#pages = new WarmPages<PageSpec, Page, LoadHint, Lease>({
      pages: options.pages,
      lock: options.lock,
      launch: () => launch(),
      ...(options.log === undefined ? {} : { log: options.log }),
      target: {
        key: specKey,
        version: async () => String((await options.build()).id),
        contextOptions: (spec) => shooterPageOptions({ ...spec, origin }),
        sameContext: (had, spec) => had.width === spec.width && had.height === spec.height,
        load: (page, spec, hint) => loadLab(page, { ...spec, origin }, hint.at, hint.camera),
        restHint: { at: 0, camera: "overview" },
      },
      makeLease: (page, spec, base) => ({
        ...base,
        shooter: Shooter.onPage(page, { ...spec, origin }),
        shots: new Map<string, Buffer>(),
      }),
    });
  }

  /** The state of the pages and the leases (`GET /__pool/status`). */
  status() {
    const status = this.#pages.status();
    const pages = status.pages.map((page) => ({ busy: page.busy, warm: page.warm, build: Number(page.version) || 0 }));
    return { ...status, pages };
  }

  /** Lease a page with the lab of a spec, at a time and a camera for a page that loads. */
  lease(spec: PageSpec, at: number, camera: string): Promise<Lease> {
    return this.#pages.lease(spec, { at, camera });
  }

  /** The lease of an ID, or null. A call marks the time of its last use. */
  get(id: string): Lease | null {
    return this.#pages.get(id);
  }

  /** End a lease: the page freezes. A dirty page loads again in the background. */
  release(id: string): Promise<void> {
    return this.#pages.release(id);
  }

  /** Load the lab of a spec into a free page before the first lease (the start of the pool, a new build). */
  warm(spec: PageSpec = defaultSpec()): Promise<void> {
    return this.#pages.warm(spec);
  }

  /** The spec of the page that a lease used last, or null. */
  lastSpec(): PageSpec | null {
    return this.#pages.lastSpec();
  }

  /** End the leases without a call for `idleMs` (a tool that ended without its release). */
  expire(idleMs: number): Promise<string[]> {
    return this.#pages.expire(idleMs);
  }

  /** Close the pages and the browser. */
  stop(): Promise<void> {
    return this.#pages.stop();
  }
}
