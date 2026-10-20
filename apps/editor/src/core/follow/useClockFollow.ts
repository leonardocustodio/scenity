// SPDX-License-Identifier: Apache-2.0
/**
 * A lab that follows the clock of the lab in another window (`follow=1`). A detached pane and the separate content
 * browser are such labs. The follower sends hello on the clock link (graph/clockLink.ts). The link is the
 * `BroadcastChannel` of a lab page without the workbench, or the link of the host in a frame of the workbench. The
 * follower applies each clock state of the main lab (applyClock.ts). When the owner moves the clock of this window (a
 * play, a pause, a seek, a speed, a take, an event, an open item), the follower sends `drive`. Then the main lab does
 * the same move. A change from a clock state of the main lab does not return as a drive.
 */
import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { LabClock } from "../useLabClock";
import type { LabTake } from "../useLabTake";
import { openChannel, type ChannelLike } from "../graph/clockLink";
import { GraphFollower } from "../graph/graphFollower";
import { clockState } from "../graph/publishClock";
import { applyClockState, type ClockTarget } from "./applyClock";

/** The interval at which a follower without a main lab sends hello again (ms). */
export const HELLO_MS = 1_000;

export interface FollowParts {
  readonly clock: LabClock;
  readonly take: LabTake;
  /** A channel (a test gives a fake); default: the channel of the page. */
  readonly channel?: ChannelLike | null;
  /** Open an item of the content browser (the separate content browser gives it). */
  readonly open?: (item: string) => void;
  readonly item?: () => string | null;
}

export interface ClockFollow {
  /** True after the first clock state of a main lab. */
  readonly linked: Ref<boolean>;
  readonly follower: GraphFollower | null;
  /** The number of the clock states that the window applied. */
  readonly applied: Ref<number>;
  stop(): void;
}

/** Start the follower; the caller stops it (`useClockFollow` stops it with the component). */
export function startClockFollow(parts: FollowParts): ClockFollow {
  const linked = ref(false);
  const applied = ref(0);
  const channel = parts.channel === undefined ? openChannel() : parts.channel;
  if (channel === null) return { linked, follower: null, applied, stop: () => undefined };
  const { clock, take } = parts;
  const target: ClockTarget = {
    clock,
    take,
    ...(parts.open ? { open: parts.open } : {}),
    ...(parts.item ? { item: parts.item } : {}),
  };
  let applying = false;
  let pending = false;
  const follower = new GraphFollower(channel, {
    onClock: (state) => {
      applying = true;
      try {
        applyClockState(target, state);
      } finally {
        applying = false;
      }
      linked.value = true;
      applied.value += 1;
    },
  });
  function drive(): void {
    pending = false;
    if (follower.main === null) return;
    follower.drive(clockState(clock, take, parts.item?.() ?? null));
  }
  // A sync watch sees the flag of a change of the main lab. One drive in each task holds all the changes of one action.
  const stopWatch = watch(
    () =>
      [
        clock.epoch.value,
        clock.running.value,
        clock.speed.value,
        take.base.value,
        take.events.value,
        parts.item?.() ?? null,
      ] as const,
    () => {
      if (applying || pending) return;
      pending = true;
      queueMicrotask(drive);
    },
    { flush: "sync" },
  );
  const hello = setInterval(() => {
    if (follower.main === null) follower.hello();
  }, HELLO_MS);
  return {
    linked,
    follower,
    applied,
    stop: () => {
      clearInterval(hello);
      stopWatch();
      follower.close();
    },
  };
}

/** The follower of a lab page; it stops with the component. */
export function useClockFollow(parts: FollowParts): ClockFollow {
  const follow = startClockFollow(parts);
  onBeforeUnmount(() => {
    follow.stop();
  });
  return follow;
}
