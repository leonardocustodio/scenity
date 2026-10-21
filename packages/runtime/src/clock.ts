// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation clock of a render worker.
 *
 * The page clock extrapolates the time of its source. The host samples it a few times per second and sends anchors
 * to the worker; the worker extrapolates from the last anchor on each frame. Both clocks follow the same rules: no
 * extrapolation while the clock does not run, at most MAX_EXTRAPOLATION_MS of wall time ahead, and never a small
 * step back.
 */

/**
 * One anchor of the simulation clock. `wallMs` is an epoch time in ms with sub-ms resolution (performance.timeOrigin +
 * performance.now()), because a worker has its own performance.now() origin.
 */
export interface ClockAnchor {
  /** The simulation time at `wallMs`, or null before the first server time. */
  readonly simMs: number | null;
  readonly wallMs: number;
  /** Simulation ms per wall ms while the session runs. */
  readonly scale: number;
  readonly running: boolean;
  /**
   * The seek count of the page clock (the 3D room lab). A new value is a jump of the page clock: the worker takes the
   * time of the anchor as it is, also a small step back. Absent: 0.
   */
  readonly epoch?: number;
}

/** The size of a drawing surface in CSS pixels and its device pixel ratio. */
export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

/** The longest wall time that the worker runs on without a new anchor, in ms (the SimClock limit). */
export const MAX_EXTRAPOLATION_MS = 600;
/** A simulation time this much below the last returned time is a real jump back (for example a fork). */
export const JUMP_BACK_MS = 1000;
/** The interval of the anchor samples of the host, in ms. */
export const ANCHOR_INTERVAL_MS = 100;

/** An epoch time in ms with sub-ms resolution. The page and a worker give the same value at the same moment. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/** The worker side: the simulation time of a frame from the last anchor. */
export class AnchorClock {
  private anchor: ClockAnchor | null = null;
  private last: number | null = null;

  set(anchor: ClockAnchor): void {
    // A new epoch is a seek of the page clock: the next time is the time of the anchor, also a small step back.
    if ((anchor.epoch ?? 0) !== (this.anchor?.epoch ?? 0)) this.last = null;
    this.anchor = anchor;
  }

  /** The seek count of the page clock in the last anchor (ClockAnchor.epoch; 0 before the first). */
  get epoch(): number {
    return this.anchor?.epoch ?? 0;
  }

  /** Return the simulation time at an epoch time, or null before the first server time. */
  read(wallMs: number): number | null {
    const anchor = this.anchor;
    const at = anchor?.simMs ?? null;
    if (anchor === null || at === null) {
      this.last = null;
      return null;
    }
    // A stopped clock reads the time of its anchor: a pause can be a little earlier than the time extrapolated before
    // it, and the frame of a stopped clock must show the time of the page clock (the 3D room lab).
    if (!anchor.running) {
      this.last = at;
      return at;
    }
    const elapsed = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, wallMs - anchor.wallMs));
    const estimate = at + elapsed * anchor.scale;
    const previous = this.last;
    const value = previous !== null && estimate < previous && previous - estimate < JUMP_BACK_MS ? previous : estimate;
    this.last = value;
    return value;
  }
}

interface Sample {
  readonly simMs: number;
  readonly wallMs: number;
}

/** Quantize a rate to steps of 0.05, so that small corrections of the page clock do not change it. */
function snapScale(rate: number): number {
  return Math.max(0, Math.round(rate * 20) / 20);
}

/**
 * The host side: makes anchors from samples of the page clock (`getSimMs`). The page clock gives a piecewise linear
 * time: its slope is the time scale while the session runs and zero during a pause. The sampler measures the slope over
 * a window of about one second.
 */
export class AnchorSampler {
  private readonly samples: Sample[] = [];
  private epoch = 0;

  constructor(
    private readonly windowMs = 1000,
    private readonly now: () => number = epochNow,
  ) {}

  /** Take one sample and return the anchor for it. `epoch`: the seek count of the page clock (ClockAnchor.epoch). */
  sample(simMs: number | null, epoch = 0): ClockAnchor {
    const wallMs = this.now();
    const seek = epoch !== this.epoch;
    this.epoch = epoch;
    if (simMs === null) {
      this.samples.length = 0;
      return { simMs: null, wallMs, scale: 1, running: false, epoch };
    }
    const previous = this.samples.at(-1);
    if (seek || (previous !== undefined && (simMs < previous.simMs - JUMP_BACK_MS || wallMs < previous.wallMs))) {
      // A jump back (a fork or a resync): start a new window.
      this.samples.length = 0;
    }
    this.samples.push({ simMs, wallMs });
    while (this.samples.length > 2 && wallMs - (this.samples[0]?.wallMs ?? wallMs) > this.windowMs) {
      this.samples.shift();
    }
    // The slope starts at the end of the last flat part (a pause), so a resume gives the full rate immediately.
    for (let i = this.samples.length - 2; i > 0; i -= 1) {
      if (this.samples[i]?.simMs === this.samples[i - 1]?.simMs) {
        this.samples.splice(0, i);
        break;
      }
    }
    const first = this.samples[0];
    const before = this.samples.at(-2);
    if (first === undefined || before === undefined || wallMs - first.wallMs <= 0) {
      return { simMs, wallMs, scale: 1, running: false, epoch };
    }
    // The clock stands still when the last two samples have the same time: a pause or no server time.
    const running = simMs > before.simMs;
    const scale = running ? snapScale((simMs - first.simMs) / (wallMs - first.wallMs)) : 0;
    return { simMs, wallMs, scale: running && scale === 0 ? 1 : scale, running, epoch };
  }
}
