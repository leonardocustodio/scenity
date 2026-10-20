// SPDX-License-Identifier: Apache-2.0
/**
 * The job queue of the frame index. A job is the input of one frame and a size. It carries no renderer. The order:
 *
 * 1. the frames of the window around the clock of the visible surface (nearest first);
 * 2. the strip of the open item (its window);
 * 3. the moments of the take;
 * 4. the whole take at 1 s;
 * 5. the whole take at 100 ms;
 * 6. the other takes.
 *
 * The rank of a job comes from the focus at the time of `take`. Thus a user action (a seek, an open item: `focus`)
 * moves its jobs to the front immediately. The plans of the page (`plan`) come after the plans of the source of the
 * project (`setBase`: the sequences and the scenes of a scene project; none for the lab). Two jobs with the same key
 * and size are one job. A new content hash makes the jobs of the old hash stale. They leave the queue, and a renderer
 * that returns one stores nothing.
 */
import { keyTime, type FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { PLAN_STEP_MS, planJobs } from "@scenity/labs-platform/indexSource";
import type { IndexJobWire, IndexProgress, IndexTakePlan } from "../indexProtocol";

/** The sizes of the index: 160 px and 640 px. 1280 px only on demand. */
export const INDEX_SIZES = [160, 640] as const;
/** Half the window around the clock (rank 1). */
export const WINDOW_MS = 2000;
/** The steps of the time line. */
export const STEP_MS = PLAN_STEP_MS;
export const OVERVIEW_MS = 1000;
/** A taken job returns to the queue after this time without an answer. */
export const LEASE_MS = 30_000;

/** What the owner looks at: the source of the visible surface, its clock and its open item. */
export interface IndexFocus {
  readonly source: string | null;
  readonly timeMs: number | null;
  readonly item: string | null;
}

type JobState = "queued" | "leased" | "done";

export interface IndexJob {
  readonly id: number;
  readonly key: string;
  readonly size: number;
  readonly input: FrameKeyInput;
  /** A named moment of the take is at this time. */
  moment: boolean;
  /** The items whose window holds this time. */
  readonly items: Set<string>;
  state: JobState;
  leaseEnd: number;
  attempts: number;
}

/** The most attempts of a job; a job that fails more often leaves the queue. */
const MAX_ATTEMPTS = 3;

/** The rank of a job for a focus: a lower list comes first. */
export function rankOf(job: IndexJob, focus: IndexFocus): number[] {
  const time = job.input.timeMs;
  const sizeRank = job.size;
  if (job.input.source !== focus.source) return [6, time % OVERVIEW_MS === 0 ? 0 : 1, sizeRank, time];
  if (focus.timeMs !== null && Math.abs(time - focus.timeMs) <= WINDOW_MS) {
    return [1, sizeRank, Math.abs(time - focus.timeMs), time];
  }
  if (focus.item !== null && job.items.has(focus.item)) return [2, sizeRank, time];
  if (job.moment) return [3, sizeRank, time];
  return [time % OVERVIEW_MS === 0 ? 4 : 5, sizeRank, time];
}

function compareRanks(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export interface QueueOptions {
  readonly now?: () => number;
  readonly sizes?: readonly number[];
}

export class IndexQueue {
  readonly #now: () => number;
  readonly #sizes: readonly number[];
  readonly #jobs = new Map<string, IndexJob>();
  readonly #byId = new Map<number, IndexJob>();
  #plans: readonly IndexTakePlan[] = [];
  /** The plans of the source of the project; they come before the plans of the page. */
  #base: readonly IndexTakePlan[] = [];
  #contentHash: string | null = null;
  #focus: IndexFocus = { source: null, timeMs: null, item: null };
  #stale = 0;
  #next = 1;
  /** The queued jobs in rank order; null after a change. */
  #order: IndexJob[] | null = null;

  constructor(options: QueueOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#sizes = options.sizes ?? INDEX_SIZES;
  }

  get contentHash(): string | null {
    return this.#contentHash;
  }

  get focus(): IndexFocus {
    return this.#focus;
  }

  /** The plans of the source of the project. The next change of the content hash (or `plan`) makes their jobs. */
  setBase(plans: readonly IndexTakePlan[]): void {
    this.#base = plans;
  }

  /** Set the takes to index under a content hash. Give the new jobs (the host drops those that the store has). */
  plan(plans: readonly IndexTakePlan[], contentHash: string): IndexJob[] {
    this.#plans = plans;
    return this.setContentHash(contentHash, true);
  }

  /**
   * A new content hash (an edit): the jobs of the old hash are stale and leave the queue. The take plans (`plan`,
   * `setBase`) make the jobs of the new hash. Give the new jobs.
   */
  setContentHash(contentHash: string, replan = false): IndexJob[] {
    if (contentHash !== this.#contentHash) {
      for (const job of this.#jobs.values()) if (job.state !== "done") this.#stale += 1;
      this.#jobs.clear();
      this.#byId.clear();
      this.#contentHash = contentHash;
    } else if (!replan) return [];
    const added: IndexJob[] = [];
    for (const plan of [...this.#base, ...this.#plans])
      for (const job of this.#jobsOf(plan, contentHash)) added.push(job);
    this.#order = null;
    return added;
  }

  /** The jobs of a plan in the order of `planJobs` (each time, each view, each size). */
  #jobsOf(plan: IndexTakePlan, contentHash: string): IndexJob[] {
    const added: IndexJob[] = [];
    for (const item of planJobs(plan, contentHash, this.#sizes)) {
      const job = this.#add(item.input, item.key, item.size);
      if (job === null) continue;
      job.moment ||= item.moment;
      for (const id of item.items) job.items.add(id);
      added.push(job);
    }
    return added;
  }

  /** Add a job; a job with the same key and size is the same job (null when it is new but done). */
  #add(input: FrameKeyInput, key: string, size: number): IndexJob | null {
    const id = `${key}|${String(size)}`;
    const old = this.#jobs.get(id);
    if (old !== undefined) return old.state === "done" ? null : old;
    const job: IndexJob = {
      id: this.#next++,
      key,
      size,
      input,
      moment: false,
      items: new Set(),
      state: "queued",
      leaseEnd: 0,
      attempts: 0,
    };
    this.#jobs.set(id, job);
    this.#byId.set(job.id, job);
    return job;
  }

  /** A user action: the jobs of the new focus come first after this call. */
  setFocus(focus: Partial<IndexFocus>): void {
    this.#focus = { ...this.#focus, ...focus };
    this.#order = null;
  }

  #queued(): IndexJob[] {
    const now = this.#now();
    for (const job of this.#byId.values()) {
      if (job.state === "leased" && job.leaseEnd <= now) {
        job.state = "queued";
        this.#order = null;
      }
    }
    if (this.#order === null) {
      const ranked = [...this.#byId.values()]
        .filter((job) => job.state === "queued")
        .map((job) => ({ job, rank: rankOf(job, this.#focus) }));
      ranked.sort((a, b) => compareRanks(a.rank, b.rank) || a.job.id - b.job.id);
      this.#order = ranked.map((item) => item.job);
    }
    return this.#order;
  }

  /** The next jobs in rank order (at most `max`), taken for LEASE_MS. `sizes` limits the sizes of a renderer. */
  take(max = 1, sizes?: readonly number[]): IndexJob[] {
    const taken: IndexJob[] = [];
    for (const job of this.#queued()) {
      if (taken.length >= max) break;
      if (job.state !== "queued" || (sizes !== undefined && !sizes.includes(job.size))) continue;
      job.state = "leased";
      job.leaseEnd = this.#now() + LEASE_MS;
      taken.push(job);
    }
    if (taken.length > 0) this.#order = this.#order?.filter((job) => job.state === "queued") ?? null;
    return taken;
  }

  /** The job of an ID, or null (an unknown or a stale job). */
  job(id: number): IndexJob | null {
    return this.#byId.get(id) ?? null;
  }

  /** A job is done (its frame is in the store). False for an unknown or a stale job. */
  done(id: number): boolean {
    const job = this.#byId.get(id);
    if (job === undefined) return false;
    job.state = "done";
    this.#order = null;
    return true;
  }

  /** A renderer returns a job. After MAX_ATTEMPTS, the job leaves the queue (it counts as done). */
  fail(id: number): void {
    const job = this.#byId.get(id);
    if (job === undefined || job.state === "done") return;
    job.attempts += 1;
    job.state = job.attempts >= MAX_ATTEMPTS ? "done" : "queued";
    this.#order = null;
  }

  progress(): IndexProgress {
    let done = 0;
    let queued = 0;
    let leased = 0;
    for (const job of this.#byId.values()) {
      if (job.state === "done") done += 1;
      else if (job.state === "queued") queued += 1;
      else leased += 1;
    }
    return { contentHash: this.#contentHash, total: this.#byId.size, done, queued, leased, stale: this.#stale };
  }
}

/** A job on the wire. */
export function wireJob(job: IndexJob): IndexJobWire {
  return { job: job.id, key: job.key, size: job.size, input: job.input };
}

/** The source of a URL of the scene page (`project` with `sequence` or `scene`), or null. */
function sceneSourceOf(params: URLSearchParams): string | null {
  if (!params.has("project")) return null;
  const sequence = params.get("sequence");
  if (sequence !== null) return `sequence:${sequence}`;
  const scene = params.get("scene");
  return scene === null ? null : `scene:${scene}`;
}

/** The focus of a lab URL (`surface.report` `url`): its source, its clock and its open item. */
export function focusOfUrl(url: string): IndexFocus | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  const track = params.get("source");
  const take = params.get("take") ?? params.get("preset");
  const lab = track?.startsWith("track:") === true ? track : take !== null ? `take:${take}` : null;
  const source = lab ?? sceneSourceOf(params);
  const time = Number(params.get("t"));
  return {
    source,
    timeMs: params.has("t") && Number.isFinite(time) ? keyTime(time) : null,
    item: params.get("item"),
  };
}
