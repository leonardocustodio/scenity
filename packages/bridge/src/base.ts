// SPDX-License-Identifier: Apache-2.0
/**
 * The base calls of the bridge: each surface page with a bridge serves them, with or
 * without a plugin. The base events (`ready`, `url`, `hmr`, `reload`, `console`, `key`) are in events.ts.
 *
 * - `url`: the URL of the page now.
 * - `capture` (args `[width?, quality?, height?, target?]`): the frame that the scene draws now, as picture bytes
 *   (an `ArrayBuffer` in the transfer list, no base64). `target` is an object of the page (for example the
 *   pane of a split screen); the page checks its fields.
 * - `console`: the errors and the warnings of the page since the last call.
 */
import { argError, defineBridgeCall, noArgs } from "./define";
import { isObject } from "./envelope";

/** The width of a capture without a width (px). */
export const DEFAULT_CAPTURE_WIDTH = 1280;
/** The largest width or height of a capture (px). */
export const MAX_CAPTURE_SIZE = 4096;

/** The result of `capture`: the simulation time and the size of the frame, and the picture. */
export interface BridgeCapture {
  readonly simMs: number | null;
  readonly width: number;
  readonly height: number;
  /** "image/webp"; a browser without a WebP encoder (WebKit) gives "image/jpeg", PNG only as a last resort. */
  readonly mime: string;
  /** The bytes of the picture; the frame moves the buffer to the parent (no copy, no base64). */
  readonly bytes: ArrayBuffer;
}

/**
 * The checked arguments of `capture`: the width, the quality (null: the default of the page), the height (0: the
 * aspect of the canvas) and the target object of the page (null: the default view).
 */
export type CaptureArgs = [width: number, quality: number | null, height: number, target: object | null];

/** The result of `console`: the errors and warnings since the last call. */
export interface ConsoleReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Read a size argument: absent gives the default; else an integer from 1 (0 when the default is 0) to the limit. */
function sizeArg(value: unknown, name: string, fallback: number): number {
  const size = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(size) || size < 0 || (size === 0 && fallback !== 0) || size > MAX_CAPTURE_SIZE) {
    argError("capture", `the ${name} must be an integer from 1 to ${String(MAX_CAPTURE_SIZE)}.`);
  }
  return size;
}

/** Check the arguments of `capture`. */
export function captureArgsOf(raw: readonly unknown[]): CaptureArgs {
  const [width, quality, height, target] = raw;
  const asked = sizeArg(width, "width", DEFAULT_CAPTURE_WIDTH);
  const tall = sizeArg(height, "height", 0);
  const level = quality === undefined || quality === null ? null : Number(quality);
  if (level !== null && !(level >= 0 && level <= 1)) argError("capture", "the quality must be a number from 0 to 1.");
  return [asked, level, tall, typeof target === "object" && target !== null ? target : null];
}

/** Read the result of `capture`. Throw an error without a picture. */
export function readCapture(raw: unknown): BridgeCapture {
  if (!isObject(raw)) throw new Error("capture: the frame gave no picture.");
  const { simMs, width, height, mime, bytes } = raw;
  if (typeof width !== "number" || typeof height !== "number" || typeof mime !== "string") {
    throw new Error("capture: the frame gave no picture.");
  }
  if (!(bytes instanceof ArrayBuffer)) throw new Error("capture: the frame gave no picture.");
  return { simMs: typeof simMs === "number" ? simMs : null, width, height, mime, bytes };
}

/** Read the result of `console`. A bad list gives an empty list. */
export function readConsole(raw: unknown): ConsoleReport {
  const item = isObject(raw) ? raw : {};
  const texts = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return { errors: texts(item.errors), warnings: texts(item.warnings) };
}

/** Read the result of `url`. */
export function readUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("url: the frame gave no URL.");
  return raw;
}

/** The base call `url`. */
export const URL_CALL = defineBridgeCall({ name: "url", args: noArgs, result: readUrl });
/** The base call `capture`. */
export const CAPTURE_CALL = defineBridgeCall({ name: "capture", args: captureArgsOf, result: readCapture });
/** The base call `console`. */
export const CONSOLE_CALL = defineBridgeCall({ name: "console", args: noArgs, result: readConsole });

/** The base calls: each surface page with a bridge serves them. */
export const BASE_CALLS = [URL_CALL, CAPTURE_CALL, CONSOLE_CALL] as const;
export type BaseCallName = (typeof BASE_CALLS)[number]["name"];
