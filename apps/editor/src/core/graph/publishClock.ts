// SPDX-License-Identifier: Apache-2.0
/**
 * The lab page end of the clock link (clockLink.ts). The lab at the top of its window sends its clock and its take at
 * each change (a seek, a play, a pause, a speed, a take, an event). It answers a new graph window, seeks at the
 * request of a graph window, and gives it the metrics of the take. The visible lab frame of the workbench sends
 * through the host (the page ignores the link of the other frames). A `drive` of a follower window (a detached pane,
 * the separate content browser) moves this clock.
 */
import { onBeforeUnmount, watch } from "vue";
import { inWorkbenchFrame } from "../bridge/workbenchLink";
import { encodeEvents } from "../sequence";
import type { LabTake } from "../useLabTake";
import type { LabClock } from "../useLabClock";
import {
  linkEnd,
  openChannel,
  wallNow,
  type ChannelLike,
  type ClockState,
  type LinkEnd,
  type LinkMessage,
} from "./clockLink";
import type { GraphData } from "./graphData";

export interface PublishParts {
  readonly clock: LabClock;
  readonly take: LabTake;
  /** The current metrics of the take (the graph data of the lab page). */
  readonly metrics: () => Promise<GraphData>;
  /** A channel (a test gives a fake); default: the `BroadcastChannel` of the page. */
  readonly channel?: ChannelLike | null;
  /** True when the page is the top of its window or a lab frame of the workbench (another frame does not send). */
  readonly top?: boolean;
  /** The open item of the content browser, or null. */
  readonly item?: () => string | null;
  /** Do the move of a follower window (follow/applyClock.ts). */
  readonly drive?: (state: ClockState) => void;
}

/** The current clock state of the lab, with all the events of the take and the open item. */
export function clockState(clock: LabClock, take: LabTake, item: string | null = null): ClockState {
  return {
    simMs: clock.simNow(),
    running: clock.running.value,
    speed: clock.speed.value,
    wallMs: wallNow(),
    take: take.base.value,
    events: take.events.value.length,
    rec: encodeEvents(take.events.value),
    item,
  };
}

async function answerMetrics(end: LinkEnd, parts: PublishParts, message: LinkMessage & { kind: "metrics?" }) {
  try {
    const data = await parts.metrics();
    end.send({
      kind: "metrics",
      from: end.id,
      to: message.from,
      id: message.id,
      take: data.take,
      samples: data.samples,
      error: data.error,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    end.send({
      kind: "metrics",
      from: end.id,
      to: message.from,
      id: message.id,
      take: null,
      samples: null,
      error: text,
    });
  }
}

/** Start the link of the lab page. It stops with the component. Returns the end, or null (a frame, no channel). */
export function publishClock(parts: PublishParts): LinkEnd | null {
  const top = parts.top ?? ((globalThis.parent as unknown) === globalThis || inWorkbenchFrame());
  const channel = parts.channel === undefined ? openChannel() : parts.channel;
  if (!top || channel === null) return null;
  const { clock, take } = parts;
  const end = linkEnd(channel, (message) => {
    if (message.kind === "hello") send();
    else if (message.kind === "seek") clock.seek(message.simMs);
    else if (message.kind === "drive") parts.drive?.(message.state);
    else if (message.kind === "metrics?") void answerMetrics(end, parts, message);
  });
  function send(): void {
    end.send({ kind: "clock", from: end.id, state: clockState(clock, take, parts.item?.() ?? null) });
  }
  const stop = watch(
    () =>
      [
        clock.epoch.value,
        clock.running.value,
        clock.speed.value,
        take.base.value,
        take.events.value,
        parts.item?.() ?? null,
      ] as const,
    send,
  );
  send();
  onBeforeUnmount(() => {
    stop();
    end.close();
  });
  return end;
}
