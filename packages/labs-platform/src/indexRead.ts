// SPDX-License-Identifier: Apache-2.0
/**
 * The readers of the frame index: the frames of one take under the current content hash, and the frames of the same
 * take under the newest older content hash ("stale" frames). After an edit, the index of the take has no frame of the
 * new hash yet. A reader then shows the old frame with a stale mark until the renderer replaces it. The host route
 * `GET /index/take/<hash>/<take>` and the store of the lab page alone give the same `TakeIndex`.
 *
 * The module is pure (no `node:`, `bun:` or DOM import).
 */
import { keyTime, viewKeyOf, type FrameView } from "./frameKey";
import type { IndexFrame, TakeManifest } from "./indexStore";

/** The frames of one take: of the current content hash, and of the newest older content hash. */
export interface TakeIndex {
  readonly current: TakeManifest | null;
  /** The manifest of the same take key under the newest older content hash that has frames, or null. */
  readonly stale: TakeManifest | null;
}

export const EMPTY_TAKE_INDEX: TakeIndex = { current: null, stale: null };

/** What a `TakeIndex` needs of a store: the content hashes (the newest use first) and a manifest by hash and take. */
export interface ManifestSource {
  contents(): Promise<readonly { readonly contentHash: string }[]>;
  manifestAt(contentHash: string, take: string): Promise<TakeManifest | null>;
}

/** The index of one take: the current manifest and the newest stale manifest. */
export async function takeIndexOf(store: ManifestSource, contentHash: string, take: string): Promise<TakeIndex> {
  const current = await store.manifestAt(contentHash, take);
  for (const use of await store.contents()) {
    if (use.contentHash === contentHash) continue;
    const old = await store.manifestAt(use.contentHash, take);
    if (old !== null && old.frames.length > 0) return { current, stale: old };
  }
  return { current, stale: null };
}

/** A frame of a take index: the record, and true when it comes from an older content hash. */
export interface IndexedFrame {
  readonly frame: IndexFrame;
  readonly stale: boolean;
}

function slotOf(timeMs: number, view: string, size: number): string {
  return `${String(keyTime(timeMs))}|${view}|${String(size)}`;
}

/**
 * A fast search of the frames of a take index by time, view and size. The current frames win over the stale frames
 * of the same slot.
 */
export class TakeFrames {
  readonly #slots = new Map<string, IndexedFrame>();
  /** The times of the frames of each view and size, sorted (for the nearest frame). */
  readonly #times = new Map<string, number[]>();
  readonly index: TakeIndex;

  constructor(index: TakeIndex) {
    this.index = index;
    for (const [manifest, stale] of [
      [index.stale, true],
      [index.current, false],
    ] as const) {
      for (const frame of manifest?.frames ?? [])
        this.#slots.set(slotOf(frame.timeMs, frame.view, frame.size), { frame, stale });
    }
    for (const { frame } of this.#slots.values()) {
      const lane = `${frame.view}|${String(frame.size)}`;
      const list = this.#times.get(lane) ?? [];
      list.push(frame.timeMs);
      this.#times.set(lane, list);
    }
    for (const list of this.#times.values()) list.sort((a, b) => a - b);
  }

  /** The count of frames (current and stale). */
  get size(): number {
    return this.#slots.size;
  }

  /** The count of stale frames (an older content hash). */
  get staleCount(): number {
    let count = 0;
    for (const item of this.#slots.values()) if (item.stale) count += 1;
    return count;
  }

  /** The frame at a time, view and size, or null. */
  at(timeMs: number, view: FrameView, size: number): IndexedFrame | null {
    return this.#slots.get(slotOf(timeMs, viewKeyOf(view), size)) ?? null;
  }

  /** The frame nearest to a time (at most `maxGapMs` away) of a view and a size, or null. */
  nearest(timeMs: number, view: FrameView, size: number, maxGapMs: number): IndexedFrame | null {
    const lane = `${viewKeyOf(view)}|${String(size)}`;
    const times = this.#times.get(lane);
    if (times === undefined || times.length === 0) return null;
    let low = 0;
    let high = times.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((times[middle] ?? 0) < timeMs) low = middle + 1;
      else high = middle;
    }
    let best: number | null = null;
    for (const index of [low - 1, low]) {
      const time = times[index];
      if (time === undefined) continue;
      if (best === null || Math.abs(time - timeMs) < Math.abs(best - timeMs)) best = time;
    }
    if (best === null || Math.abs(best - timeMs) > maxGapMs) return null;
    return this.at(best, view, size);
  }
}

/** A metric value of the lab: the index keeps it in a flat record. */
export interface IndexMetric {
  readonly metric: string;
  readonly member: string | null;
  readonly value: number;
  readonly unit?: string;
}

/** The metrics of a frame as the flat record of the index: `<member>|<metric>|<unit>` → value. */
export function metricsRecord(values: readonly IndexMetric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of values) {
    if (!Number.isFinite(item.value)) continue;
    out[`${item.member ?? "scene"}|${item.metric}|${item.unit ?? ""}`] = item.value;
  }
  return out;
}

/** The metric values of a flat record of the index (`metricsRecord`), sorted by member and metric. */
export function metricsList(record: Readonly<Record<string, number>> | null): IndexMetric[] {
  if (record === null) return [];
  return Object.entries(record)
    .map(([key, value]) => {
      const [member = "scene", metric = "", unit = ""] = key.split("|");
      return { member, metric, value, unit };
    })
    .sort((a, b) => a.member.localeCompare(b.member) || a.metric.localeCompare(b.metric));
}
