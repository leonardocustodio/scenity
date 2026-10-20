// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the frame index. `protocol.ts` exports them. The module is pure (no `node:` or `bun:` import),
 * so a page gets them through `@scenity/workbench-host/protocol`.
 *
 * - `index.plan`: a page (the lab) gives the takes to index: their inputs, durations, moments, views and items. The
 *   host makes the jobs of the queue (`index/queue.ts`).
 * - `index.next`: a renderer (the indexer window, the shadow frame, the render pool) takes jobs. A job is a frame
 *   input and a size. It carries no renderer.
 * - `index.done`: the renderer gives the frame of a job: first one binary WebSocket frame (`encodeIndexFrame`, the
 *   bytes of the picture), then this request with the byte count and the metrics. `index.fail` returns a job.
 * - `index.status`: the content hash, the bytes of the store and the progress of the queue.
 * - `index.progress` (event): the progress after a change of the queue.
 *
 * The page reads a frame at `GET /index/<key>?size=<px>` with the token header (absent size: the smallest size). It
 * reads the manifest of a take at `GET /index/manifest/<contentHash>/<take key>`.
 */
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import type { IndexPlan } from "@scenity/labs-platform/indexSource";

/**
 * The input of the frames of one take or sequence: every input of `FrameKeyInput` but the time, the view and the hash
 * (`IndexPlan` of `@scenity/labs-platform/indexSource`, with the scene parts of a scene project).
 */
export type IndexTakePlan = IndexPlan;

/** A job of the queue on the wire. */
export interface IndexJobWire {
  readonly job: number;
  readonly key: string;
  readonly size: number;
  readonly input: FrameKeyInput;
}

/** The progress of the queue. */
export interface IndexProgress {
  readonly contentHash: string | null;
  /** The jobs of the current plan: done, waiting, taken by a renderer. */
  readonly total: number;
  readonly done: number;
  readonly queued: number;
  readonly leased: number;
  /** The jobs of an old content hash that the last change of the hash made stale. */
  readonly stale: number;
}

/** The requests of the frame index (page or renderer to host). `RequestMap` of protocol.ts extends this map. */
export interface IndexRequests {
  "index.plan": {
    params: { takes: readonly IndexTakePlan[]; contentHash?: string };
    result: { contentHash: string; jobs: number };
  };
  "index.next": {
    params: { renderer: string; max?: number; sizes?: readonly number[] };
    result: { jobs: IndexJobWire[] };
  };
  "index.done": {
    params: {
      job: number;
      bytes: number;
      mime: string;
      metrics?: Readonly<Record<string, number>> | null;
      /**
       * The pose families that the frame read. A frame with its reads can move to a new content hash when an edit
       * changes only families that it does not read.
       */
      reads?: readonly string[] | null;
    };
    result: { stored: boolean };
  };
  "index.fail": { params: { job: number; error: string }; result: null };
  /** `carried`: the frames that moved to a new content hash with no render since the start of the host. */
  "index.status": { params: object; result: IndexProgress & { usage: number; carried?: number } };
  /**
   * The workbench page renders jobs in the shadow frame. The host starts the shadow or keeps it (its idle
   * time starts again) and says whether it is ready.
   */
  "index.shadow": { params: object; result: { ready: boolean } };
}

export const INDEX_REQUEST_NAMES: Readonly<Record<keyof IndexRequests, true>> = {
  "index.plan": true,
  "index.next": true,
  "index.done": true,
  "index.fail": true,
  "index.status": true,
  "index.shadow": true,
};

/** The events of the frame index (host to page). `EventMap` of protocol.ts extends this map. */
export interface IndexEvents {
  "index.progress": IndexProgress;
}

export const INDEX_EVENT_NAMES: Readonly<Record<keyof IndexEvents, true>> = { "index.progress": true };

/** The path of the index routes of the host. */
export const INDEX_PATH = "/index/";
/**
 * The route of the frames of one take, `GET /index/take/<contentHash>/<take key>`: a `TakeIndex` of
 * `@scenity/labs-platform/indexRead` (the manifest of the hash and the newest stale manifest of the take).
 */
export const INDEX_TAKE_PATH = "/index/take/";

// The binary WebSocket frame of an index picture (renderer to host): the layout of the picture frames
// (pictureProtocol.ts) with its own magic, so the two never mix.
/** The first bytes of an index frame: "WBI" and the version of the frame layout. */
export const INDEX_FRAME_MAGIC = [0x57, 0x42, 0x49, 0x01] as const;
const MIME_MAX = 64;
const FIXED_HEADER = INDEX_FRAME_MAGIC.length + 4 + 1;

/** An index frame: the job number, the MIME type and the bytes (a view, no copy). */
export interface IndexFrameData {
  readonly job: number;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** The whole binary frame of the picture of a job. */
export function encodeIndexFrame(job: number, mime: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(job) || job < 0 || job > 0xffff_ffff) throw new Error("An index frame needs a job number.");
  if (mime.length === 0 || mime.length > MIME_MAX || !/^[\x21-\x7e]+$/.test(mime)) {
    throw new Error("An index frame needs a MIME type of 1 to 64 ASCII characters.");
  }
  const frame = new Uint8Array(FIXED_HEADER + mime.length + bytes.length);
  frame.set(INDEX_FRAME_MAGIC, 0);
  new DataView(frame.buffer).setUint32(INDEX_FRAME_MAGIC.length, job, true);
  frame[FIXED_HEADER - 1] = mime.length;
  for (let index = 0; index < mime.length; index += 1) frame[FIXED_HEADER + index] = mime.charCodeAt(index);
  frame.set(bytes, FIXED_HEADER + mime.length);
  return frame;
}

/** Read an index frame; null for bytes that are not one (a picture frame, for example). */
export function readIndexFrame(data: Uint8Array): IndexFrameData | null {
  if (data.length < FIXED_HEADER) return null;
  if (INDEX_FRAME_MAGIC.some((byte, index) => data[index] !== byte)) return null;
  const job = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(INDEX_FRAME_MAGIC.length, true);
  const length = data[FIXED_HEADER - 1] ?? 0;
  if (length === 0 || length > MIME_MAX || data.length < FIXED_HEADER + length) return null;
  let mime = "";
  for (let index = 0; index < length; index += 1) {
    const code = data[FIXED_HEADER + index] ?? 0;
    if (code < 0x21 || code > 0x7e) return null;
    mime += String.fromCharCode(code);
  }
  return { job, mime, bytes: data.subarray(FIXED_HEADER + length) };
}
