// SPDX-License-Identifier: Apache-2.0
/**
 * The clock of a player, as the page clock of the scene page: the time in whole ms on the time line of a sequence.
 * The clock plays from a start time, or stands at a time. Each seek, play and pause gives a new seek count
 * (ClockAnchor.epoch), so the render worker takes the new time as it is.
 */
export class PlayerClock {
  /** The seek count (ClockAnchor.epoch). */
  epoch = 0;
  #start: number;
  #origin: number;
  #playing = false;

  constructor(
    readonly duration: number,
    readonly loop: boolean,
    start: number,
    private readonly wall: () => number,
  ) {
    this.#start = this.#clamp(start);
    this.#origin = wall();
  }

  get playing(): boolean {
    return this.#playing;
  }

  /** The current time of the clock. */
  now(): number {
    if (!this.#playing) return this.#start;
    const t = Math.round(this.#start + this.wall() - this.#origin);
    return this.loop ? t % (this.duration + 1) : Math.min(t, this.duration);
  }

  /** True when a clock with no loop plays and stands at the end. */
  atEnd(): boolean {
    return this.#playing && !this.loop && this.now() >= this.duration;
  }

  /** Stand at a time (a seek). */
  seek(t: number): void {
    this.#start = this.#clamp(t);
    this.#playing = false;
    this.epoch += 1;
  }

  /** Play from the current time (from 0 at the end of a time line with no loop). */
  play(): void {
    const at = this.now();
    this.#start = !this.loop && at >= this.duration ? 0 : at;
    this.#origin = this.wall();
    this.#playing = true;
    this.epoch += 1;
  }

  pause(): void {
    this.seek(this.now());
  }

  #clamp(t: number): number {
    const value = Number.isFinite(t) ? Math.round(t) : 0;
    return Math.min(Math.max(0, value), this.duration);
  }
}
