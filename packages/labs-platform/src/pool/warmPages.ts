// SPDX-License-Identifier: Apache-2.0
/**
 * The warm pages of a render pool: one browser, N page slots, the leases of the slots, the queue of the leases that
 * wait for a free slot, and one GPU lock that the current leases share. The lab pool
 * (apps/editor/scripts/lab/pool/pages.ts: the lab page) and the scene pool of `scenity pool` (packages/cli/src/pool:
 * the player page) give the page target: the key of a spec, its version, its context options and the load of a page.
 *
 * A free slot with the key and the version of a spec is warm: the lease needs no page load. Else the pool loads the
 * spec into the free slot that waited longest. A lease that ran a script in the page (`dirty`) leaves the page cold,
 * and the pool loads it again in the background. A page without a lease is frozen (the web lifecycle state of
 * Chromium): it draws nothing and keeps its decoded assets. The lock is held while a lease runs, not for the life of
 * the pool, so other tools can draw between the leases.
 *
 * The module has no Playwright import: the browser, the context and the page are the small structural types below.
 */

/** The CDP session of a page (only `Page.setWebLifecycleState`). */
export interface PoolCdp {
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** The parts of a browser context that the pool uses. */
export interface PoolContext<P> {
  newPage(): Promise<P>;
  newCDPSession(page: P): Promise<PoolCdp>;
  close(): Promise<void>;
}

/** The parts of a browser that the pool uses. */
export interface PoolBrowser<P> {
  isConnected(): boolean;
  newContext(options: never): Promise<PoolContext<P>>;
  close(): Promise<void>;
}

/** The fields of a lease that the pool reads and writes. */
export interface WarmLease {
  readonly id: string;
  /** True after a script ran in the page: the page is cold after the lease. */
  dirty: boolean;
  lastCall: number;
  /** True when the page was warm at the start of the lease. */
  readonly warm: boolean;
  /** The wait for the GPU lock and the time to make the page ready (ms). */
  readonly lockMs: number;
  readonly openMs: number;
}

/** The page target of a pool: what a spec is and how a page loads it. `H` is the hint of a load (a time, a camera). */
export interface PageTarget<S, P, H> {
  /** The key of a spec: two specs with the same key load the same page. */
  key(spec: S): string;
  /** The version of the inputs of a spec (a build, a content stamp); a new version loads the page again. */
  version(spec: S): Promise<string>;
  /** The options of a new context for a spec. */
  contextOptions(spec: S): unknown;
  /** True when a page of the context of `had` can load `spec` (for example the same page size). */
  sameContext(had: S, spec: S): boolean;
  /** Load the spec into a page. */
  load(page: P, spec: S, hint: H): Promise<void>;
  /** The hint of a load in the background (after a dirty lease, the warm call). */
  readonly restHint: H;
}

export interface WarmPagesOptions<S, P, H, L extends WarmLease> {
  readonly pages: number;
  readonly target: PageTarget<S, P, H>;
  /** Take the GPU lock; give the release function. */
  readonly lock: () => Promise<() => void>;
  readonly launch: () => Promise<PoolBrowser<P>>;
  /** Make the lease of a ready page. */
  readonly makeLease: (page: P, spec: S, base: WarmLease) => L;
  readonly log?: (line: string) => void;
}

interface Slot<S, P> {
  readonly index: number;
  context: PoolContext<P> | null;
  page: P | null;
  cdp: PoolCdp | null;
  /** The key of the spec in the page, or null for a page to load again. */
  key: string | null;
  spec: S | null;
  version: string;
  busy: boolean;
  lastUse: number;
}

let leaseNumber = 0;

/** A new lease ID. */
function leaseId(): string {
  leaseNumber += 1;
  return `${String(leaseNumber)}-${Math.random().toString(16).slice(2, 10)}`;
}

export class WarmPages<S, P, H, L extends WarmLease> {
  readonly #options: WarmPagesOptions<S, P, H, L>;
  readonly #slots: Slot<S, P>[];
  readonly #leases = new Map<string, { lease: L; slot: Slot<S, P> }>();
  readonly #waiting: (() => void)[] = [];
  #browser: Promise<PoolBrowser<P>> | null = null;
  #active = 0;
  #release: Promise<() => void> | null = null;
  #stopped = false;
  #warming = false;

  constructor(options: WarmPagesOptions<S, P, H, L>) {
    this.#options = options;
    this.#slots = Array.from({ length: Math.max(1, options.pages) }, (_, index) => ({
      index,
      context: null,
      page: null,
      cdp: null,
      key: null,
      spec: null,
      version: "",
      busy: false,
      lastUse: 0,
    }));
  }

  /** The state of the pages and the leases. */
  status() {
    return {
      pages: this.#slots.map((slot) => ({ busy: slot.busy, warm: slot.key !== null, version: slot.version })),
      leases: this.#leases.size,
      waiting: this.#waiting.length,
    };
  }

  /** The browser (it starts on the first call, and again after a disconnect). */
  browser(): Promise<PoolBrowser<P>> {
    if (this.#browser === null) {
      this.#browser = this.#options.launch();
      this.#browser.catch(() => (this.#browser = null));
    }
    return this.#browser.then(async (browser) => {
      if (browser.isConnected()) return browser;
      this.#browser = null;
      for (const slot of this.#slots) Object.assign(slot, { context: null, page: null, cdp: null, key: null });
      return this.browser();
    });
  }

  /** Take the lock (the current leases share it). A failure (a time limit) holds nothing. */
  async #hold(): Promise<void> {
    this.#active += 1;
    const taking = (this.#release ??= this.#options.lock());
    try {
      await taking;
    } catch (error) {
      this.#active -= 1;
      if (this.#release === taking) this.#release = null;
      throw error;
    }
  }

  #unhold(): void {
    this.#active -= 1;
    if (this.#active > 0 || this.#release === null) return;
    const release = this.#release;
    this.#release = null;
    void release.then(
      (done) => done(),
      () => undefined,
    );
  }

  /** A free slot: one with the key and the version, else the one that waited longest. Waits while each is busy. */
  async #take(key: string, version: string): Promise<Slot<S, P>> {
    for (;;) {
      const free = this.#slots.filter((slot) => !slot.busy);
      const best =
        free.find((slot) => slot.key === key && slot.version === version && slot.page !== null) ??
        free.sort((a, b) => a.lastUse - b.lastUse)[0];
      if (best !== undefined) {
        best.busy = true;
        return best;
      }
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
  }

  #free(slot: Slot<S, P>): void {
    slot.busy = false;
    slot.lastUse = performance.now();
    this.#waiting.shift()?.();
  }

  /** Load a spec into a slot (a new context when the old one does not fit the spec). */
  async #open(slot: Slot<S, P>, spec: S, version: string, hint: H): Promise<void> {
    const { target } = this.#options;
    const fits = slot.spec !== null && target.sameContext(slot.spec, spec);
    if (slot.page === null || slot.context === null || !fits) {
      await slot.context?.close().catch(() => null);
      const browser = await this.browser();
      slot.context = await browser.newContext(target.contextOptions(spec) as never);
      slot.page = await slot.context.newPage();
      slot.cdp = await slot.context.newCDPSession(slot.page).catch(() => null);
    }
    slot.key = null;
    await this.#lifecycle(slot, "active");
    await target.load(slot.page, spec, hint);
    slot.key = target.key(spec);
    slot.spec = spec;
    slot.version = version;
  }

  /** Freeze a page without a lease, or wake it for a lease (Chromium only; a failure leaves the page as it is). */
  async #lifecycle(slot: Slot<S, P>, state: "active" | "frozen"): Promise<void> {
    await slot.cdp?.send("Page.setWebLifecycleState", { state }).catch(() => null);
  }

  /** Lease a page with a spec; `hint` goes to the load of a page that is not warm. */
  async lease(spec: S, hint: H): Promise<L> {
    if (this.#stopped) throw new Error("The render pool stopped.");
    const version = await this.#options.target.version(spec);
    const key = this.#options.target.key(spec);
    const slot = await this.#take(key, version);
    let held = false;
    try {
      const asked = performance.now();
      await this.#hold();
      held = true;
      const locked = performance.now();
      const warm = slot.key === key && slot.version === version && slot.page !== null;
      if (warm) await this.#lifecycle(slot, "active");
      else await this.#open(slot, spec, version, hint);
      const page = slot.page;
      if (page === null) throw new Error("The pool page is not there.");
      const base: WarmLease = {
        id: leaseId(),
        dirty: false,
        lastCall: performance.now(),
        warm,
        lockMs: Math.round(locked - asked),
        openMs: Math.round(performance.now() - locked),
      };
      const lease = this.#options.makeLease(page, spec, base);
      this.#leases.set(lease.id, { lease, slot });
      return lease;
    } catch (error) {
      slot.key = null;
      if (held) this.#unhold();
      this.#free(slot);
      throw error;
    }
  }

  /** The lease of an ID, or null. A call marks the time of its last use. */
  get(id: string): L | null {
    const entry = this.#leases.get(id);
    if (entry === undefined) return null;
    entry.lease.lastCall = performance.now();
    return entry.lease;
  }

  /** End a lease: the page freezes; a dirty page loads again in the background. */
  async release(id: string): Promise<void> {
    const entry = this.#leases.get(id);
    if (entry === undefined) return;
    this.#leases.delete(id);
    const { lease, slot } = entry;
    const spec = slot.spec;
    if (lease.dirty) slot.key = null;
    this.#unhold();
    if (lease.dirty && spec !== null && !this.#stopped) {
      // The slot stays busy while its page loads again.
      void this.#rewarm(slot, spec);
      return;
    }
    await this.#lifecycle(slot, "frozen");
    this.#free(slot);
  }

  async #rewarm(slot: Slot<S, P>, spec: S): Promise<void> {
    try {
      const version = await this.#options.target.version(spec);
      await this.#hold();
      try {
        await this.#open(slot, spec, version, this.#options.target.restHint);
      } finally {
        this.#unhold();
      }
      await this.#lifecycle(slot, "frozen");
    } catch (error) {
      slot.key = null;
      this.#options.log?.(`a page did not load again: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.#free(slot);
    }
  }

  /**
   * Load a spec into a free page before the first lease. A warm call while another one runs does nothing; a warm call
   * never waits for a busy page.
   */
  async warm(spec: S): Promise<void> {
    if (this.#warming || this.#stopped) return;
    this.#warming = true;
    try {
      const version = await this.#options.target.version(spec);
      const key = this.#options.target.key(spec);
      if (this.#slots.some((slot) => slot.key === key && slot.version === version)) return;
      const slot = this.#slots.filter((item) => !item.busy).sort((a, b) => a.lastUse - b.lastUse)[0];
      if (slot === undefined) return;
      slot.busy = true;
      await this.#rewarm(slot, spec);
    } finally {
      this.#warming = false;
    }
  }

  /** The spec of the page that a lease used last, or null. */
  lastSpec(): S | null {
    const used = this.#slots.filter((slot) => slot.spec !== null).sort((a, b) => b.lastUse - a.lastUse)[0];
    return used?.spec ?? null;
  }

  /** End the leases without a call for `idleMs` (a tool that ended without its release). */
  async expire(idleMs: number): Promise<string[]> {
    const now = performance.now();
    const old = [...this.#leases.values()].filter((entry) => now - entry.lease.lastCall > idleMs);
    for (const entry of old) await this.release(entry.lease.id);
    return old.map((entry) => entry.lease.id);
  }

  /** Close the pages and the browser. */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const id of [...this.#leases.keys()]) await this.release(id).catch(() => null);
    const browser = this.#browser;
    this.#browser = null;
    if (browser !== null) await (await browser.catch(() => null))?.close();
  }
}
