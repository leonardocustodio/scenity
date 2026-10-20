// SPDX-License-Identifier: Apache-2.0
/**
 * The plan of the index of the open take and the picture cache of the readers. The workbench page sends the plan to
 * the host (`index.plan`). The host queue makes a job of each time, view and size. No Vue import.
 */
import type { FrameKeyInput, FrameView, RendererBackend } from "@scenity/labs-platform/frameKey";
import type { IndexFrame } from "@scenity/labs-platform/indexStore";
import { momentsOf, takeEnd, takeLength, type LabEvent } from "../sequence";

/** The plan of one take (`IndexTakePlan` of packages/workbench-host/src/indexProtocol.ts). */
export interface TakePlan {
  readonly source: string;
  readonly events: readonly unknown[];
  readonly tunes: FrameKeyInput["tunes"];
  readonly renderer: FrameKeyInput["renderer"];
  readonly tier: string;
  readonly backend?: RendererBackend;
  readonly durationMs: number;
  readonly moments: readonly number[];
  readonly views: readonly FrameView[];
  readonly items?: readonly { readonly id: string; readonly from: number; readonly to: number }[];
}

/** The length of the index of a take: the end of its sweep, or after its last event. */
export function indexDuration(take: string | null, events: readonly LabEvent[], trackEnd: number | null): number {
  if (trackEnd !== null) return trackEnd;
  return Math.max(takeLength(take ?? "idle"), takeEnd(events));
}

/** The times of the named moments of a take. */
export function momentTimes(take: string | null): number[] {
  return Object.values(momentsOf(take));
}

/** The plan of the page: the open take with its view and the window of its open item. */
export function takePlan(
  page: FrameKeyInput,
  durationMs: number,
  moments: readonly number[],
  item: { readonly id: string; readonly from: number; readonly to: number } | null,
): TakePlan {
  return {
    source: page.source,
    events: page.events,
    tunes: page.tunes,
    renderer: page.renderer,
    tier: page.tier,
    ...(page.backend === undefined ? {} : { backend: page.backend }),
    durationMs,
    moments,
    views: [page.view],
    ...(item === null ? {} : { items: [item] }),
  };
}

/** The object URLs of the pictures of the index: the last LIMIT pictures stay. */
export class PictureUrls {
  static readonly LIMIT = 400;
  readonly #urls = new Map<string, Promise<string | null>>();
  readonly #load: (frame: IndexFrame) => Promise<Blob | null>;

  constructor(load: (frame: IndexFrame) => Promise<Blob | null>) {
    this.#load = load;
  }

  /** The object URL of a frame (one load per frame key and size). */
  url(frame: IndexFrame): Promise<string | null> {
    const id = `${frame.key}|${String(frame.size)}`;
    const kept = this.#urls.get(id);
    if (kept !== undefined) {
      this.#urls.delete(id);
      this.#urls.set(id, kept);
      return kept;
    }
    const made = this.#load(frame).then(
      (blob) => (blob === null ? null : URL.createObjectURL(blob)),
      () => null,
    );
    this.#urls.set(id, made);
    for (const [old, url] of this.#urls) {
      if (this.#urls.size <= PictureUrls.LIMIT) break;
      this.#urls.delete(old);
      void url.then((text) => {
        if (text !== null) URL.revokeObjectURL(text);
      });
    }
    // A failed load is not kept: the next read tries again.
    void made.then((url) => {
      if (url === null) this.#urls.delete(id);
    });
    return made;
  }

  clear(): void {
    for (const url of this.#urls.values()) {
      void url.then((text) => {
        if (text !== null) URL.revokeObjectURL(text);
      });
    }
    this.#urls.clear();
  }
}
