// SPDX-License-Identifier: Apache-2.0
/**
 * The index reads of a frame: a second envelope beside the calls. A frame in the workbench reads the frame index of the
 * host through the workbench page, so the frame never holds the token of the host.
 *
 * - Frame to page: `{ workbenchIndex: 1, id, op: "take", contentHash, take }` or `{ …, op: "frame", key, size }`.
 * - Page to frame: `{ workbenchIndex: 1, id, result }` (the picture bytes move, no copy) or `{ …, id, error }`.
 */
import { errorText, isObject } from "./envelope";

/** The key of an index read message. Its value is the version (1). */
export const INDEX_READ_MARK = "workbenchIndex";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

/** A read of the index, without the envelope key. */
export type IndexRead =
  | { readonly id: number; readonly op: "take"; readonly contentHash: string; readonly take: string }
  | { readonly id: number; readonly op: "frame"; readonly key: string; readonly size: number };

/** A read of the index (frame to page). */
export type IndexReadRequest = { readonly workbenchIndex: 1 } & IndexRead;

/** The answer of a read (page to frame): the result (a take index, the bytes of a frame, null on a miss) or an error. */
export interface IndexReadAnswer<Result = unknown> {
  readonly workbenchIndex: 1;
  readonly id: number;
  readonly result?: Result;
  readonly error?: string;
}

/** The message of a read. */
export function indexReadMessage(read: IndexRead): IndexReadRequest {
  return { workbenchIndex: 1, ...read };
}

/** A valid read of a frame, or null for another message. */
export function readIndexRead(data: unknown): IndexRead | null {
  if (!isObject(data) || data.workbenchIndex !== 1 || typeof data.id !== "number") return null;
  if (data.op === "take" && typeof data.contentHash === "string" && typeof data.take === "string") {
    if (!HEX32.test(data.contentHash) || !HEX16.test(data.take)) return null;
    return { id: data.id, op: "take", contentHash: data.contentHash, take: data.take };
  }
  if (data.op === "frame" && typeof data.key === "string" && typeof data.size === "number") {
    if (!HEX32.test(data.key) || !Number.isSafeInteger(data.size) || data.size <= 0) return null;
    return { id: data.id, op: "frame", key: data.key, size: data.size };
  }
  return null;
}

/** True for the answer of a read (page to frame). */
export function isIndexReadAnswer(value: unknown): value is IndexReadAnswer {
  return isObject(value) && value.workbenchIndex === 1 && typeof value.id === "number" && !("op" in value);
}

/** The answer message of a read with a result. */
export function indexResultMessage<Result>(id: number, result: Result): IndexReadAnswer<Result> {
  return { workbenchIndex: 1, id, result };
}

/** The answer message of a read with an error. */
export function indexErrorMessage(id: number, error: unknown): IndexReadAnswer<never> {
  return { workbenchIndex: 1, id, error: errorText(error) };
}
