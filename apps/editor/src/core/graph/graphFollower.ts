// SPDX-License-Identifier: Apache-2.0
/**
 * The graph window end of the clock link (clockLink.ts). It sends hello and follows the clock of the lab that
 * answered last (the main lab). It sends seeks to the main lab and asks it for the metrics of its take. The class has
 * no framework. GraphPage.vue connects it to Vue.
 */
import {
  linkEnd,
  timeAt,
  wallNow,
  type ChannelLike,
  type ClockState,
  type LinkEnd,
  type LinkMessage,
} from "./clockLink";
import type { MetricSample } from "./series";

export interface LinkedMetrics {
  readonly take: string | null;
  readonly samples: readonly MetricSample[] | null;
  readonly error: string | null;
}

export interface FollowerEvents {
  /** A new clock state of the main lab (a seek, a play, a pause, another take or new events). */
  readonly onClock: (state: ClockState) => void;
}

export class GraphFollower {
  readonly #end: LinkEnd;
  readonly #events: FollowerEvents;
  readonly #asks = new Map<number, (value: LinkedMetrics) => void>();
  #main: string | null = null;
  #state: ClockState | null = null;
  #next = 1;

  constructor(channel: ChannelLike, events: FollowerEvents) {
    this.#events = events;
    this.#end = linkEnd(channel, (message) => {
      this.#receive(message);
    });
    this.#end.send({ kind: "hello", from: this.#end.id });
  }

  #receive(message: LinkMessage): void {
    if (message.kind === "clock") {
      this.#main = message.from;
      this.#state = message.state;
      this.#events.onClock(message.state);
    } else if (message.kind === "metrics") {
      const answer = this.#asks.get(message.id);
      this.#asks.delete(message.id);
      answer?.({ take: message.take, samples: message.samples, error: message.error });
    }
  }

  /** The ID of the lab that the window follows, or null. */
  get main(): string | null {
    return this.#main;
  }

  get state(): ClockState | null {
    return this.#state;
  }

  /** The current time of the clock of the main lab, or null without a main lab. */
  time(wallMs: number = wallNow()): number | null {
    return this.#state === null ? null : timeAt(this.#state, wallMs);
  }

  /** Wait for a main lab for a maximum of `ms` (after the hello). */
  async waitMain(ms: number): Promise<string | null> {
    const end = Date.now() + ms;
    while (this.#main === null && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
    return this.#main;
  }

  /** Send hello again (a window whose first hello found no main lab). */
  hello(): void {
    this.#end.send({ kind: "hello", from: this.#end.id });
  }

  /** Move the clock of the main lab as this window moved its own clock. */
  drive(state: ClockState): void {
    this.#end.send({ kind: "drive", from: this.#end.id, to: this.#main, state });
  }

  /** Seek the clock of the main lab. */
  seek(simMs: number): void {
    this.#end.send({ kind: "seek", from: this.#end.id, to: this.#main, simMs });
  }

  /** The metrics of the take of the main lab (null: no main lab, or no answer in `timeoutMs`). */
  metrics(timeoutMs = 60_000): Promise<LinkedMetrics | null> {
    const main = this.#main;
    if (main === null) return Promise.resolve(null);
    const id = this.#next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#asks.delete(id);
        resolve(null);
      }, timeoutMs);
      this.#asks.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.#end.send({ kind: "metrics?", from: this.#end.id, to: main, id });
    });
  }

  close(): void {
    this.#end.close();
  }
}
