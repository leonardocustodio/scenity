// SPDX-License-Identifier: Apache-2.0
/**
 * The time of a simulation source in a player and the first frame of a plugin core.
 *
 * - With no sequence, a recorded source gives the time line: a clock of its duration. A live source has no end: its
 *   clock plays from the time of each push, so the core draws the time of the engine.
 * - With a sequence, the clock of the sequence stays; the source gives only the input at the clock time.
 * - A plugin core takes no documents, so no "loaded" answer tells the player that the scene is on the canvas. The
 *   player reads the statistics until the core drew the first frame and the assets are loaded.
 */
import type { LiveSource, SimulationSource } from "@scenity/scene/sequence";
import type { DocumentClient } from "@scenity/runtime/documentClient";
import { PlayerClock } from "./clock";
import type { LoadContext, PlayerDeps } from "./deps";
import type { PlayerContent } from "./project";
import type { PlayerOptions } from "./types";

/** The duration of the clock of a live source: no end in practice. */
export const LIVE_DURATION = Number.MAX_SAFE_INTEGER;

/** A push of a live source this far before the clock time moves the clock back to the time of the push (ms). */
export const LIVE_DRIFT_MS = 250;

/** The wait between two reads of the statistics of a plugin core before its first frame (ms). */
export const SETTLE_POLL_MS = 100;

function isLive(source: SimulationSource): source is LiveSource {
  const live = source as Partial<LiveSource>;
  return source.kind === "live" && typeof live.subscribe === "function" && typeof live.latest === "function";
}

/** The clock of a source with no sequence: the clock as it is when its duration fits, else a new clock. */
export function clockOf(
  source: SimulationSource,
  current: PlayerClock | null,
  options: PlayerOptions,
  now: () => number,
): PlayerClock {
  const recorded = source.kind === "recorded" ? source.duration : undefined;
  const duration = recorded ?? LIVE_DURATION;
  if (current?.duration === duration) return current;
  const start = current?.now() ?? options.start ?? 0;
  return new PlayerClock(duration, recorded !== undefined && options.loop === true, start, now);
}

/**
 * Move the clock with the pushes of a live source: the clock plays from the time of a push when it stands, when the
 * push is after the clock time, or when the push is too far before it. `moved` runs after each push. The result
 * stops the listener. A recorded source has no listener, and the result is null.
 */
export function followLive(source: SimulationSource, clock: PlayerClock, moved: () => void): (() => void) | null {
  if (!isLive(source)) return null;
  const follow = (t: number): void => {
    // A live state at a time after the clock has no state before it in the buffer: the clock goes to its time.
    const now = clock.now();
    if (!clock.playing || t > now || now - t > LIVE_DRIFT_MS) {
      clock.seek(t);
      clock.play();
    }
    moved();
  };
  const latest = source.latest();
  if (latest !== undefined) follow(latest.t);
  return source.subscribe((t) => {
    follow(t);
  });
}

/** Wait until a plugin core drew its first frame and its assets stopped to load (or `stopped` is true). */
export async function coreSettled(
  client: DocumentClient,
  timer: PlayerDeps["timer"],
  stopped: () => boolean,
): Promise<void> {
  for (;;) {
    const stats = await client.stats();
    if (stopped() || (stats.frames > 0 && stats.assets !== "loading")) return;
    await new Promise<void>((resolve) => {
      timer(resolve, SETTLE_POLL_MS);
    });
  }
}

/** The load of a plugin core: it takes no documents, so the player waits for its first frame with the assets. */
export async function loadPluginCore(
  client: DocumentClient,
  content: PlayerContent,
  context: LoadContext,
): Promise<string[]> {
  await coreSettled(client, context.timer, () => context.stopped());
  return [...content.warnings];
}
