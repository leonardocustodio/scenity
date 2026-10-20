// SPDX-License-Identifier: Apache-2.0
/**
 * The frames of the compare view: the picture of a side at a time from a camera. A take of the current code comes
 * from the frame index when the index has the key. Else the hidden lab frame draws it, and the index keeps it with its
 * metrics. Thus the next compare and the metrics graph find it. A take of an older content hash comes only from the
 * index: the nearest frame of its manifest. The object URLs of the last frames stay in a small memory. When a URL
 * goes from the memory, the class revokes it.
 */
import { frameKey, viewKeyOf } from "@scenity/labs-platform/frameKey";
import type { FrameIndexStore, IndexFrame, IndexMime } from "@scenity/labs-platform/indexStore";
import { t } from "../../texts";
import { COMPARE_WIDTH, plainTakeInput } from "./frameInput";
import type { CompareSide } from "./sources";

/** The picture of one side. */
export interface FrameShot {
  /** The object URL of the picture, or null (no picture). */
  readonly url: string | null;
  /** The simulation time of the picture (an older content hash can give the nearest frame). */
  readonly simMs: number | null;
  readonly from: "index" | "render" | "none";
  /** The time to get the picture (ms). */
  readonly ms: number;
  readonly note: string | null;
}

/** A frame that the hidden lab drew: the bytes and the metrics of the frame. */
export interface RenderedFrame {
  readonly bytes: Uint8Array;
  readonly mime: IndexMime;
  readonly simMs: number | null;
  readonly metrics: Readonly<Record<string, number>> | null;
}

export interface CompareFrameParts {
  /** The frame index, or null when the page has no frame index. */
  readonly store: () => Promise<FrameIndexStore | null>;
  readonly contentHash: () => string;
  /** Draw a frame of a take of the current code, or null (no hidden lab). */
  readonly render: ((take: string, timeMs: number, camera: string) => Promise<RenderedFrame>) | null;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
  readonly now?: () => number;
}

/** The number of object URLs that stay. */
const KEEP = 48;

export class CompareFrames {
  readonly #parts: CompareFrameParts;
  /** The object URLs by frame key, the oldest first. */
  readonly #urls = new Map<string, { url: string; simMs: number | null }>();

  constructor(parts: CompareFrameParts) {
    this.#parts = parts;
  }

  #now(): number {
    return (this.#parts.now ?? (() => performance.now()))();
  }

  #remember(key: string, bytes: Uint8Array, mime: string, simMs: number | null): string {
    const create = this.#parts.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
    const url = create(new Blob([new Uint8Array(bytes)], { type: mime }));
    this.#urls.set(key, { url, simMs });
    while (this.#urls.size > KEEP) {
      const [oldest] = this.#urls.keys();
      if (oldest === undefined) break;
      const entry = this.#urls.get(oldest);
      this.#urls.delete(oldest);
      if (entry !== undefined) (this.#parts.revokeUrl ?? ((value) => URL.revokeObjectURL(value)))(entry.url);
    }
    return url;
  }

  #recall(key: string): { url: string; simMs: number | null } | null {
    const entry = this.#urls.get(key);
    if (entry === undefined) return null;
    this.#urls.delete(key);
    this.#urls.set(key, entry);
    return entry;
  }

  /** The picture of a side at a time from a camera. */
  async frame(side: CompareSide, timeMs: number, camera: string): Promise<FrameShot> {
    const start = this.#now();
    const shot = (rest: Omit<FrameShot, "ms">): FrameShot => ({ ...rest, ms: this.#now() - start });
    try {
      if (side.kind === "hash") return shot(await this.#older(side, timeMs, camera));
      return shot(await this.#current(side.take, timeMs, camera));
    } catch (error) {
      return shot({
        url: null,
        simMs: null,
        from: "none",
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #current(take: string, timeMs: number, camera: string): Promise<Omit<FrameShot, "ms">> {
    const input = plainTakeInput(take, timeMs, camera, this.#parts.contentHash());
    const key = frameKey(input);
    const known = this.#recall(key);
    if (known !== null) return { url: known.url, simMs: known.simMs, from: "index", note: null };
    const store = await this.#parts.store();
    const hit = await store?.get(key, COMPARE_WIDTH);
    if (hit !== null && hit !== undefined) {
      const url = this.#remember(key, hit.bytes, hit.frame.mime, hit.frame.timeMs);
      return { url, simMs: hit.frame.timeMs, from: "index", note: null };
    }
    if (this.#parts.render === null)
      return { url: null, simMs: null, from: "none", note: t("compare-no-frame-no-lab") };
    const drawn = await this.#parts.render(take, timeMs, camera);
    const url = this.#remember(key, drawn.bytes, drawn.mime, drawn.simMs);
    // The index keeps the frame for the next compare and for the graph. A full store is not an error here.
    // The store writes the manifest after a delay. Write it immediately, so a reload or a close keeps the frame.
    await store
      ?.put({ input, size: COMPARE_WIDTH, mime: drawn.mime, bytes: drawn.bytes, metrics: drawn.metrics })
      .then(() => store.flush())
      .catch(() => undefined);
    return { url, simMs: drawn.simMs, from: "render", note: null };
  }

  async #older(side: CompareSide & { kind: "hash" }, timeMs: number, camera: string): Promise<Omit<FrameShot, "ms">> {
    const store = await this.#parts.store();
    const manifest = await store?.manifest(plainTakeInput(side.take, timeMs, camera, side.contentHash));
    const view = viewKeyOf(camera);
    const frames = (manifest?.frames ?? []).filter((frame) => frame.view === view);
    const nearest = frames.reduce<IndexFrame | null>((best, frame) => {
      if (best === null) return frame;
      const gap = Math.abs(frame.timeMs - timeMs) - Math.abs(best.timeMs - timeMs);
      return gap < 0 || (gap === 0 && frame.size === COMPARE_WIDTH) ? frame : best;
    }, null);
    if (store === null || nearest === null) {
      return { url: null, simMs: null, from: "none", note: t("compare-no-older-frame") };
    }
    const id = `${nearest.key}|${String(nearest.size)}`;
    const known = this.#recall(id);
    const hit = known === null ? await store.get(nearest.key, nearest.size) : null;
    const url = known?.url ?? (hit === null ? null : this.#remember(id, hit.bytes, nearest.mime, nearest.timeMs));
    const seconds = (nearest.timeMs / 1000).toFixed(1);
    const note = nearest.timeMs === Math.round(timeMs) ? null : t("compare-nearest-frame", { seconds });
    return { url, simMs: nearest.timeMs, from: url === null ? "none" : "index", note };
  }

  /** Revoke all object URLs (the view closes). */
  clear(): void {
    for (const entry of this.#urls.values())
      (this.#parts.revokeUrl ?? ((value) => URL.revokeObjectURL(value)))(entry.url);
    this.#urls.clear();
  }
}
