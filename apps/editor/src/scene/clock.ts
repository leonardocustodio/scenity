// SPDX-License-Identifier: Apache-2.0
/**
 * The time of the scene page: the sequence of the project over the scene and the page clock. The clock plays
 * from a start time, or stands at a time (`paused=1`, a seek). A seek gives a new seek count, so the render worker
 * takes the new time as it is (ClockAnchor.epoch). The scene core draws the frame of the clock time.
 */
import { builtinRegistry, readDocument, type SequenceDocument } from "@scenity/scene";
import { t } from "../texts";

/** The sequence at `path` of the project at `base`, or null with no path. */
export async function readSequence(base: string, path: string | null): Promise<SequenceDocument | null> {
  if (path === null) return null;
  const response = await fetch(`${base}${path}`);
  if (!response.ok) {
    throw new Error(t("scene-error-no-sequence", { url: `${base}${path}`, status: String(response.status) }));
  }
  const result = readDocument(await response.text(), "sequence", { registry: builtinRegistry() });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  return result.doc;
}

/** The first sequence of the project file at `base`, or null when the project has none. */
export async function defaultSequencePath(base: string): Promise<string | null> {
  const response = await fetch(`${base}scenity.project.json`);
  if (!response.ok) return null;
  const result = readDocument(await response.text(), "project");
  return result.ok ? (result.doc.sequences?.[0] ?? null) : null;
}

/** The page clock of a sequence: the time in whole ms on the time line. */
export class PageClock {
  /** The seek count (ClockAnchor.epoch). */
  epoch = 0;
  #start: number;
  #origin = performance.now();
  #playing: boolean;
  /** The clock ms for each wall ms. */
  #speed = 1;

  constructor(
    private readonly duration: number,
    private readonly loop: boolean,
    start: number,
    playing: boolean,
  ) {
    this.#start = start;
    this.#playing = playing;
  }

  get playing(): boolean {
    return this.#playing;
  }

  /** The time of the clock now. */
  now(): number {
    if (!this.#playing) return this.#start;
    const t = Math.round(this.#start + (performance.now() - this.#origin) * this.#speed);
    return this.loop ? t % (this.duration + 1) : Math.min(t, this.duration);
  }

  /** Stand at a time (a seek). */
  seek(t: number): void {
    this.#start = Math.min(Math.max(0, Math.round(t)), this.duration);
    this.#playing = false;
    this.epoch += 1;
  }

  /** Play from the time now (from 0 at the end of a time line with no loop). */
  play(): void {
    const at = this.now();
    this.#start = !this.loop && at >= this.duration ? 0 : at;
    this.#origin = performance.now();
    this.#playing = true;
    this.epoch += 1;
  }

  pause(): void {
    this.seek(this.now());
  }

  get speed(): number {
    return this.#speed;
  }

  /** Change the speed. The time now stays, and the clock continues at the new speed. */
  setSpeed(speed: number): void {
    if (!(speed > 0) || speed === this.#speed) return;
    this.#start = this.now();
    this.#origin = performance.now();
    this.#speed = speed;
    this.epoch += 1;
  }
}
