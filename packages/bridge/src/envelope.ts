// SPDX-License-Identifier: Apache-2.0
/**
 * The envelope of the bridge: the `postMessage` data
 * between the workbench page (the parent) and a surface page in a frame (the editor).
 *
 * - Parent to frame: a call `{ workbench: 1, id, call, args }`.
 * - Frame to parent: an answer `{ workbench: 1, id, result }` or `{ workbench: 1, id, error }`, or an event
 *   `{ workbench: 1, event, ... }` (events.ts).
 *
 * The value of the `workbench` key is the version of the envelope. The module is pure: no Vue, no DOM, no Node API.
 */

/** The URL parameter that turns the bridge on in a surface page: the origin of the workbench page. */
export const BRIDGE_PARAM = "workbench";
/** The key of each bridge message. Its value is the version of the envelope. */
export const BRIDGE_KEY = "workbench";
/** The version of the envelope. A message with another version gets no answer. */
export const BRIDGE_VERSION = 1;
export type BridgeVersion = typeof BRIDGE_VERSION;

/** Parent to frame: a call. `call` is a base call (base.ts), a plugin call or a method of the script API. */
export interface BridgeCall {
  readonly workbench: BridgeVersion;
  readonly id: number;
  readonly call: string;
  readonly args: readonly unknown[];
}

/** Frame to parent: the answer to a call. */
export type BridgeAnswer =
  | { readonly workbench: BridgeVersion; readonly id: number; readonly result: unknown }
  | { readonly workbench: BridgeVersion; readonly id: number; readonly error: string };

/** True for a plain object (not null, not an array). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for the ID of a call: a safe integer, 0 or more. */
export function isCallId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The message of a call. */
export function callMessage(id: number, call: string, args: readonly unknown[] = []): BridgeCall {
  return { workbench: BRIDGE_VERSION, id, call, args: [...args] };
}

/** The message of an answer with a result. */
export function resultMessage(id: number, result: unknown): BridgeAnswer {
  return { workbench: BRIDGE_VERSION, id, result };
}

/** The message of an answer with an error. */
export function errorMessage(id: number, error: unknown): BridgeAnswer {
  return { workbench: BRIDGE_VERSION, id, error: errorText(error) };
}

/** The text of an error of a call: the message of an `Error`, else the value as text. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a call of the bridge (parent to frame). */
export function isBridgeCall(value: unknown): value is BridgeCall {
  return (
    isObject(value) &&
    value.workbench === BRIDGE_VERSION &&
    isCallId(value.id) &&
    typeof value.call === "string" &&
    value.call.length > 0 &&
    Array.isArray(value.args)
  );
}

/**
 * The call of a message that the frame receives, or null. The frame accepts a call without `args` (an empty list).
 */
export function readCall(value: unknown): BridgeCall | null {
  if (!isObject(value) || value.workbench !== BRIDGE_VERSION || !isCallId(value.id)) return null;
  if (typeof value.call !== "string" || value.call.length === 0) return null;
  return callMessage(value.id, value.call, Array.isArray(value.args) ? value.args : []);
}

/** True for an answer of the bridge (frame to parent). */
export function isBridgeAnswer(value: unknown): value is BridgeAnswer {
  if (!isObject(value) || value.workbench !== BRIDGE_VERSION || !isCallId(value.id) || "event" in value) return false;
  return "result" in value || typeof value.error === "string";
}

/** The outcome of an answer: its result or its error. */
export function answerOutcome(answer: BridgeAnswer): { readonly result: unknown } | { readonly error: string } {
  return "error" in answer && typeof answer.error === "string"
    ? { error: answer.error }
    : { result: (answer as { result: unknown }).result };
}

/**
 * The origin of the `workbench` URL parameter, or null. The value is `scheme://host[:port]`, without a path; the
 * origin of the Tauri page (`tauri://localhost`) is valid too.
 */
export function bridgeOrigin(search: string): string | null {
  const value = new URLSearchParams(search).get(BRIDGE_PARAM)?.trim().replace(/\/$/, "") ?? "";
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s@]+)$/i.exec(value);
  if (match === null) return null;
  return `${(match[1] ?? "").toLowerCase()}://${(match[2] ?? "").toLowerCase()}`;
}

/**
 * The picture bytes of a result (`capture`, `sheet`): an `ArrayBuffer` in `bytes`. The frame moves it to the
 * parent in the transfer list, so no copy and no base64 occurs in the page.
 */
export function transferOf(value: unknown): ArrayBuffer[] {
  if (typeof value !== "object" || value === null) return [];
  const bytes = (value as { bytes?: unknown }).bytes;
  return bytes instanceof ArrayBuffer ? [bytes] : [];
}

/** A result that `postMessage` can copy: a value that structured clone refuses goes through JSON. */
export function cloneable(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    structuredClone(value);
    return value;
  } catch {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}

/** The answer message of a result: picture bytes move, another value is made cloneable. */
export function answerOf(
  id: number,
  value: unknown,
): { readonly message: BridgeAnswer; readonly transfer: ArrayBuffer[] } {
  const transfer = transferOf(value);
  return { message: resultMessage(id, transfer.length > 0 ? value : cloneable(value)), transfer };
}
