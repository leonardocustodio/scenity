// SPDX-License-Identifier: Apache-2.0
/**
 * The queue of screen-reader announcements. It has no framework code, so `bun test` checks it with a fake clock.
 *
 * Rules:
 * - Assertive items (new high-priority alarms, team questions) go before polite items.
 * - The queue gives at most one item per minimum interval (2 s by default), so a real-time scene does not
 *   flood the screen reader.
 * - An item with a key replaces a queued item with the same key (for example the state of one order), so the
 *   screen reader gets only the latest state.
 * - An item that waits longer than its time to live is stale and the queue drops it.
 */

export type Politeness = "polite" | "assertive";

export interface AnnounceOptions {
  readonly politeness?: Politeness;
  /** Items with the same key replace each other while they wait. */
  readonly key?: string;
  /** The longest wait before the item is stale, in ms. */
  readonly ttlMs?: number;
}

export interface Announcement {
  readonly id: number;
  readonly text: string;
  readonly politeness: Politeness;
  readonly key: string | null;
  /** The time when the item entered the queue. */
  readonly queuedAt: number;
  readonly expiresAt: number;
}

export interface AnnouncerQueueOptions {
  /** The minimum time between two announcements, in ms. Default 2000. */
  readonly minIntervalMs?: number;
  /** The default time to live of an item, in ms. Default 10000. */
  readonly ttlMs?: number;
  /** The clock in ms. Default performance.now(). */
  readonly now?: () => number;
  /** Run a function after a delay and return a function that cancels it. Default setTimeout. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}

const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const handle = setTimeout(run, delayMs);
  return () => {
    clearTimeout(handle);
  };
};

export class AnnouncerQueue {
  private readonly items: Announcement[] = [];
  private readonly minIntervalMs: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private lastAt = Number.NEGATIVE_INFINITY;
  private nextId = 1;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly emit: (item: Announcement) => void,
    options: AnnouncerQueueOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 2000;
    this.ttlMs = options.ttlMs ?? 10_000;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** The number of items that wait. */
  get size(): number {
    return this.items.length;
  }

  /** Add an item. The queue ignores empty text. */
  announce(text: string, options: AnnounceOptions = {}): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const at = this.now();
    const item: Announcement = {
      id: this.nextId++,
      text: trimmed,
      politeness: options.politeness ?? "polite",
      key: options.key ?? null,
      queuedAt: at,
      expiresAt: at + (options.ttlMs ?? this.ttlMs),
    };
    const same = item.key === null ? -1 : this.items.findIndex((other) => other.key === item.key);
    if (same >= 0) {
      this.items.splice(same, 1, item);
    } else {
      this.items.push(item);
    }
    this.pump();
  }

  /** Remove every item that waits. */
  clear(): void {
    this.items.length = 0;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  /** Stop the timer. The queue can still take items after this. */
  dispose(): void {
    this.clear();
  }

  private next(): Announcement | undefined {
    const at = this.now();
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const item = this.items[i];
      if (item !== undefined && item.expiresAt < at) this.items.splice(i, 1);
    }
    const index = this.items.findIndex((item) => item.politeness === "assertive");
    const [item] = this.items.splice(index >= 0 ? index : 0, 1);
    return item;
  }

  private pump(): void {
    if (this.cancelTimer !== null || this.items.length === 0) return;
    const wait = this.lastAt + this.minIntervalMs - this.now();
    if (wait > 0) {
      this.cancelTimer = this.schedule(() => {
        this.cancelTimer = null;
        this.pump();
      }, wait);
      return;
    }
    const item = this.next();
    if (item === undefined) return;
    this.lastAt = this.now();
    this.emit(item);
    if (this.items.length > 0) this.pump();
  }
}
