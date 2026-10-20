// SPDX-License-Identifier: Apache-2.0
/**
 * The clock link of the views in other windows. The lab page sends the state of its clock and its take on a
 * `BroadcastChannel` of its origin. A graph window (`?view=graph`) follows the clock, seeks it, and asks the lab for
 * the metrics of its take. A lab page in a different frame (the shadow frame of the compare view) does not send. The
 * window of the owner is the lab at the top.
 *
 * A lab frame of the workbench page uses the link of the host in place of the `BroadcastChannel` (workbenchLink.ts).
 * Thus a lab in another window of the app or of the browser follows the lab of the main window. A follower (a detached
 * pane, the separate content browser, follow/useClockFollow.ts) sends `drive` when the owner moves its clock. Then
 * the main lab does the same move.
 *
 * The clock state has the wall time of the sender (`wallNow`). Thus a follower calculates the time of a clock that
 * runs without a message for each frame.
 */
import { bridgeChannel, inWorkbenchFrame } from "../bridge/workbenchLink";
import type { MetricSample } from "./series";

/** The name of the channel. */
export const CLOCK_CHANNEL = "scenity-clock";

/** The state of the clock of a lab page. */
export interface ClockState {
  readonly simMs: number;
  readonly running: boolean;
  readonly speed: number;
  /** The wall time of the state (ms, `wallNow` of the sender). */
  readonly wallMs: number;
  readonly take: string | null;
  /** The number of the events of the take (a change of the events makes the metrics stale). */
  readonly events: number;
  /** All the events of the live take (`encodeEvents`), so a follower draws the same scene. */
  readonly rec?: string;
  /** The open item of the content browser, or null. */
  readonly item?: string | null;
}

export type LinkMessage =
  | { readonly kind: "clock"; readonly from: string; readonly state: ClockState }
  | { readonly kind: "hello"; readonly from: string }
  | { readonly kind: "seek"; readonly from: string; readonly to: string | null; readonly simMs: number }
  /** A follower moved its clock (or opened an item). The main lab does the same. */
  | { readonly kind: "drive"; readonly from: string; readonly to: string | null; readonly state: ClockState }
  | { readonly kind: "metrics?"; readonly from: string; readonly to: string; readonly id: number }
  | {
      readonly kind: "metrics";
      readonly from: string;
      readonly to: string;
      readonly id: number;
      readonly take: string | null;
      readonly samples: readonly MetricSample[] | null;
      readonly error: string | null;
    };

/**
 * The current wall time (ms since the epoch) at the resolution of `performance.now`. The pages of one machine share
 * it, because `performance.timeOrigin` is the wall time of the start of each page.
 */
export function wallNow(): number {
  return performance.timeOrigin + performance.now();
}

/** The time of a clock state at a wall time. */
export function timeAt(state: ClockState, wallMs: number): number {
  return state.running ? state.simMs + Math.max(0, wallMs - state.wallMs) * state.speed : state.simMs;
}

/** The part of a channel that the link uses (a test gives a fake pair). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

function isLinkMessage(value: unknown): value is LinkMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { kind?: unknown; from?: unknown };
  return typeof message.kind === "string" && typeof message.from === "string";
}

/** A new ID of one end of the link. */
export function linkId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The channel of the page: the link of the host in a lab frame of the workbench, else the `BroadcastChannel` of the
 * origin. Returns null when the browser has no `BroadcastChannel`.
 */
export function openChannel(): ChannelLike | null {
  if (inWorkbenchFrame()) return bridgeChannel(CLOCK_CHANNEL);
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(CLOCK_CHANNEL) : null;
}

/** One end of the link: send a message, receive the messages of the other ends, close. */
export interface LinkEnd {
  readonly id: string;
  send(message: LinkMessage): void;
  close(): void;
}

export function linkEnd(
  channel: ChannelLike,
  onMessage: (message: LinkMessage) => void,
  id: string = linkId(),
): LinkEnd {
  const listener = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!isLinkMessage(data) || data.from === id) return;
    if ("to" in data && data.to !== null && data.to !== id) return;
    onMessage(data);
  };
  channel.addEventListener("message", listener);
  return {
    id,
    send(message) {
      channel.postMessage(message);
    },
    close() {
      channel.removeEventListener("message", listener);
      channel.close();
    },
  };
}
