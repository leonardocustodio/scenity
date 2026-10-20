// SPDX-License-Identifier: Apache-2.0
/**
 * The adaptive quality ladder of the player. For each window of LADDER_WINDOW_MS during a play, the ladder reads the
 * frame work p95 of the core (the update and the render calls) and changes the quality tier:
 *
 * - down by one tier after SLOW_TO_STEP_DOWN slow windows in a row: the work p95 is over WORK_LIMIT_MS;
 * - up by one tier after GOOD_TO_STEP_UP good windows in a row: the work p95 is at most RAISE_SHARE of the limit (the
 *   hysteresis, so the tier does not move up and down at each window);
 * - only in the tiers of the project (`quality.tiers`, default low, medium and high), never above the tier of the
 *   options. The core limits the effects of each tier.
 *
 * Determinism: the ladder acts only in a live play. A pause, a seek and the end of the sequence apply the tier of the
 * options again before the frame of the stopped clock. Thus a frame at a stopped clock (a seek, a capture) is the
 * same frame when the clock played to that time and when a seek went there. The ladder steps never go into the
 * documents, the URL or a frame key. `adaptive: false` disables the ladder.
 */
import { TIER_ORDER } from "@scenity/runtime/adapt";
import type { SceneStats, Tier } from "@scenity/runtime/protocol";
import type { PlayerQuality } from "./types";

/** The length of one measurement window in ms. */
export const LADDER_WINDOW_MS = 1000;
/** The limit of the frame work p95 in ms (the CPU p95 of a frame is at most 6 ms). */
export const WORK_LIMIT_MS = 6;
/** Slow windows in a row before a step down. */
export const SLOW_TO_STEP_DOWN = 2;
/** Good windows in a row before a step up. */
export const GOOD_TO_STEP_UP = 8;
/** A good window has a work p95 of at most this share of the limit. */
export const RAISE_SHARE = 0.5;
/** The project tiers when the project gives none (the default of `quality.tiers`). */
const DEFAULT_TIERS: readonly string[] = ["low", "medium", "high"];

/**
 * The tiers of the ladder from the best to the lowest: the tier of the options, then each lower tier that the project
 * allows. Project tier names that are not runtime tiers are ignored.
 */
export function ladderTiers(first: Tier, projectTiers: readonly string[] | undefined): Tier[] {
  const allowed = projectTiers ?? DEFAULT_TIERS;
  return TIER_ORDER.slice(TIER_ORDER.indexOf(first)).filter((tier) => tier === first || allowed.includes(tier));
}

export interface LadderState {
  /** The index of the current tier in the ladder tiers. */
  readonly step: number;
  readonly slow: number;
  readonly good: number;
}

export const LADDER_START: LadderState = { step: 0, slow: 0, good: 0 };

export type LadderAction = "none" | "down" | "up";

/** One window of the ladder: the work p95 of its frames in ms, and the number of frames. */
export function ladderWindow(
  state: LadderState,
  workP95: number,
  frames: number,
  steps: number,
): { readonly state: LadderState; readonly action: LadderAction } {
  // A window with no frame (a hidden page, a core that draws on change only) decides nothing.
  if (frames === 0) return { state, action: "none" };
  if (workP95 > WORK_LIMIT_MS) {
    const slow = state.slow + 1;
    if (slow < SLOW_TO_STEP_DOWN || state.step >= steps - 1)
      return { state: { ...state, slow, good: 0 }, action: "none" };
    return { state: { step: state.step + 1, slow: 0, good: 0 }, action: "down" };
  }
  if (workP95 <= RAISE_SHARE * WORK_LIMIT_MS) {
    const good = state.good + 1;
    if (good < GOOD_TO_STEP_UP || state.step === 0) return { state: { ...state, slow: 0, good }, action: "none" };
    return { state: { step: state.step - 1, slow: 0, good: 0 }, action: "up" };
  }
  return { state: { ...state, slow: 0, good: 0 }, action: "none" };
}

/** The part of a document client that the ladder uses. */
export interface LadderClient {
  stats(reset?: boolean): Promise<SceneStats>;
  setTier(tier: Tier): void;
}

/** The step event of the ladder. */
export interface QualityStep {
  readonly tier: Tier;
  readonly from: Tier;
  readonly workP95: number;
}

export interface LadderParams {
  readonly tiers: readonly Tier[];
  readonly on: boolean;
  readonly client: () => LadderClient | null;
  /** The clock plays (a live play). */
  readonly playing: () => boolean;
  readonly step: (detail: QualityStep) => void;
  readonly every: (callback: () => void, ms: number) => () => void;
}

/** The driver of the ladder: a timer of windows, the tier of the client and the test hook. */
export class QualityLadder {
  readonly #params: LadderParams;
  #state: LadderState = LADDER_START;
  #stop: (() => void) | null = null;
  /** The client of the last tier message; a new client (a fallback) starts at the tier of the options. */
  #applied: LadderClient | null = null;
  /** The tier that the client of `#applied` draws with. */
  #sent: Tier | null = null;
  /** The test hook: the work p95 in ms that replaces the measured value, or null. */
  #forced: number | null = null;

  constructor(params: LadderParams) {
    this.#params = params;
  }

  /** The state for `player.quality`. */
  get state(): PlayerQuality {
    return { on: this.#params.on, tier: this.tier, tiers: this.#params.tiers };
  }

  /** The tier of the ladder (the tier of a live play). */
  get tier(): Tier {
    const tiers = this.#params.tiers;
    return tiers[Math.min(this.#state.step, tiers.length - 1)] ?? "low";
  }

  start(): void {
    if (!this.#params.on || this.#stop !== null) return;
    this.#stop = this.#params.every(() => {
      void this.#window();
    }, LADDER_WINDOW_MS);
  }

  /** A play starts: the client gets the tier of the ladder. */
  play(): void {
    this.#apply(this.tier);
  }

  /** The clock stops (a pause, a seek, the end): the client gets the tier of the options before the next frame. */
  stop(): void {
    this.#apply(this.#params.tiers[0] ?? "high");
  }

  /** The test hook of the e2e tests: `ms` replaces each measured work p95; null measures again. */
  forceWork(ms: number | null): void {
    this.#forced = ms === null ? null : Math.max(0, ms);
  }

  dispose(): void {
    this.#stop?.();
    this.#stop = null;
  }

  #apply(tier: Tier): void {
    const client = this.#params.client();
    if (client === null) return;
    if (client !== this.#applied) {
      this.#applied = client;
      this.#sent = this.#params.tiers[0] ?? null;
    }
    if (tier === this.#sent) return;
    client.setTier(tier);
    this.#sent = tier;
  }

  async #window(): Promise<void> {
    const client = this.#params.client();
    if (client === null || !this.#params.playing()) return;
    if (client !== this.#applied) this.play();
    const stats = await client.stats(true);
    // The window ends with a pause or a fallback: it decides nothing.
    if (client !== this.#params.client() || !this.#params.playing()) return;
    const work = this.#forced ?? stats.workP95;
    const from = this.tier;
    const result = ladderWindow(this.#state, work, stats.frames, this.#params.tiers.length);
    this.#state = result.state;
    if (result.action === "none") return;
    this.#apply(this.tier);
    this.#params.step({ tier: this.tier, from, workP95: Math.round(work * 100) / 100 });
  }
}
