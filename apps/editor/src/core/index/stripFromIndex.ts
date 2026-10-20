// SPDX-License-Identifier: Apache-2.0
/**
 * The frame strip reads the frame index first. A slot that the strip cache does not have takes the frame of the index
 * at the nearest step of 100 ms (at most 50 ms from the slot time, the 160 px size). Thus the strip renders only the
 * misses. A frame of an older content hash shows with a stale mark, and the fill of the strip draws that slot again.
 * No Vue import.
 */
import type { IndexedFrame } from "@scenity/labs-platform/indexRead";
import { STEP_MS } from "./frameInput";

/** The size of a strip frame in the index. */
export const STRIP_SIZE = 160;

/** What the strip needs of the lab index. */
export interface StripIndex {
  lookup(timeMs: number, options?: { readonly size?: number; readonly maxGapMs?: number }): IndexedFrame | null;
  /** The picture of a frame as a Blob (the strip makes its own object URL), or null. */
  blob(frame: IndexedFrame["frame"]): Promise<Blob | null>;
}

/** A slot of the strip (useFrameStrip.ts `StripSlot`). */
export interface IndexSlot {
  readonly index: number;
  readonly at: number;
  readonly url: string | null;
}

/** The patch of a slot from the index: its picture, the time of its frame and the stale mark. */
export interface IndexSlotPatch {
  readonly url: string;
  readonly simMs: number;
  readonly stale: boolean;
}

/**
 * Fill the empty slots from the index. `current` tells if the strip still has the same key (a new key stops the
 * fill). The result is the count of slots that the index filled.
 */
export async function slotsFromIndex(
  index: StripIndex | null,
  slots: readonly IndexSlot[],
  current: () => boolean,
  set: (slot: number, patch: IndexSlotPatch) => void,
): Promise<number> {
  if (index === null) return 0;
  let filled = 0;
  for (const slot of slots) {
    if (slot.url !== null) continue;
    const found = index.lookup(slot.at, { size: STRIP_SIZE, maxGapMs: STEP_MS / 2 });
    if (found === null) continue;
    const blob = await index.blob(found.frame);
    if (blob === null || !current()) continue;
    set(slot.index, { url: URL.createObjectURL(blob), simMs: found.frame.timeMs, stale: found.stale });
    filled += 1;
  }
  return filled;
}
