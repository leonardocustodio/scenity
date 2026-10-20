// SPDX-License-Identifier: Apache-2.0
/**
 * The parts that all MCP tools of the workbench use: the result shape of MCP, the definition of a tool, the readers of
 * the bridge results and the cut of a long list. A tool result is short: a few lines and at most one image.
 */
import { sendBridgeCall, URL_CALL, type BridgeCallDef } from "@scenity/bridge";
import type { z } from "zod";
import { isCaptureMime, type Capture } from "./capture";
import type { SceneToolContext, SurfacePort } from "./context";

/** One block of a tool result (MCP `CallToolResult.content`). */
export type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** The result of a tool, in the shape of MCP. */
export interface ToolResult {
  readonly content: readonly ToolContent[];
  readonly isError?: boolean;
}

/**
 * A tool: its name, its description in plain words, its zod input schema and its handler. `C` is the context that the
 * handler reads (a host can give more than `SceneToolContext`).
 */
export interface ToolDef<S extends z.ZodObject = z.ZodObject, C extends SceneToolContext = SceneToolContext> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  /** True: Claude Code loads the tool with the first prompt. False: the tool search finds it. */
  readonly alwaysLoad: boolean;
  handler(input: z.output<S>, ctx: C): Promise<ToolResult>;
}

/** Define a tool. The function only gives the types. */
export function defineTool<S extends z.ZodObject, C extends SceneToolContext = SceneToolContext>(
  tool: ToolDef<S, C>,
): ToolDef<S, C> {
  return tool;
}

/** A result of text lines. */
export function textResult(lines: string | readonly string[]): ToolResult {
  return { content: [{ type: "text", text: typeof lines === "string" ? lines : lines.join("\n") }] };
}

/** A tool error with a text. */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The text of a thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The readers of the bridge results. The bridge gives JSON data; the readers do not trust its shape.
/** True for a plain object. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object, or an empty object. */
export function record(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

/** The array, or an empty array. */
export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The text, or null. */
export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The finite number, or null. */
export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A number with at most `digits` decimals and no zeros at the end. */
export function fmt(value: number, digits = 3): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * The lines of a list with at most `max` items. A longer list ends with one line of the count of the other items and
 * a hint (for example the tool that shows them).
 */
export function cut<T>(items: readonly T[], max: number, line: (item: T) => string, hint = ""): string[] {
  const out = items.slice(0, max).map(line);
  const rest = items.length - max;
  if (rest > 0) out.push(`… and ${String(rest)} more${hint === "" ? "" : ` (${hint})`}`);
  return out;
}

/** The items joined with ", ", with at most `max` items and the count of the others. */
export function joinCut(items: readonly string[], max: number, hint = ""): string {
  const shown = items.slice(0, max).join(", ");
  const rest = items.length - max;
  if (rest <= 0) return shown;
  return `${shown} and ${String(rest)} more${hint === "" ? "" : ` (${hint})`}`;
}

// The calls of the bridge.
/** The time for a call that draws a frame or measures (ms). */
export const FRAME_TIMEOUT_MS = 60_000;
/** The time for a short call (ms). */
export const CALL_TIMEOUT_MS = 10_000;

/** Send a call to a frame with a timeout. */
export function call(
  port: SurfacePort,
  name: string,
  args: readonly unknown[] = [],
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
  return port.call(name, args, { timeoutMs });
}

/**
 * Send a typed call of `@scenity/bridge` (a base call or a plugin call) to a frame with a timeout. The arguments and
 * the result go through the checks of the definition, as on the frame side.
 */
export function callTyped<Args extends readonly unknown[], Result>(
  port: SurfacePort,
  def: BridgeCallDef<Args, Result>,
  args: Args,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Result> {
  return sendBridgeCall(def, (name, raw) => port.call(name, raw, { timeoutMs }), ...args);
}

/** The current URL of a frame (the base call `url` of `@scenity/bridge`). */
export function frameUrl(port: SurfacePort, timeoutMs = CALL_TIMEOUT_MS): Promise<string> {
  return callTyped(port, URL_CALL, [], timeoutMs);
}

/** The frame of a `where` input: the shadow frame or the visible lab frame. */
export function portOf(ctx: SceneToolContext, where: "visible" | "shadow" | undefined): SurfacePort {
  return ctx.surface(where === "shadow" ? "shadow" : "visible");
}

/**
 * The bytes of a picture result of the bridge: the bytes of the binary frame (`bytes`), or the base64 `data` of a lab
 * page of an older checkout. Null without a picture.
 */
export function pictureBytes(item: Record<string, unknown>): Uint8Array | null {
  if (item.bytes instanceof Uint8Array) return item.bytes;
  const data = text(item.data);
  return data === null ? null : new Uint8Array(Buffer.from(data, "base64"));
}

/** Read a capture of the bridge (`capture`, `sheet`): WebP, or JPEG from WebKit. Throw an error without a picture. */
export function captureOf(value: unknown): Capture {
  const item = record(value);
  const mime = item.mime;
  const bytes = pictureBytes(item);
  const width = number(item.width);
  const height = number(item.height);
  if (!isCaptureMime(mime) || bytes === null || width === null || height === null) {
    throw new Error("capture: the frame gave no picture.");
  }
  return { simMs: number(item.simMs), width, height, mime, bytes };
}

/** The image block of a tool result. The base64 encode occurs here, at the MCP boundary, and nowhere before it. */
export function imageContent(picture: Pick<Capture, "bytes" | "mime">): ToolContent {
  const { bytes } = picture;
  // A Buffer view of the bytes: no copy before the base64 text.
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  return { type: "image", data, mimeType: picture.mime };
}

// The URL state of the lab (Room3DLab.vue, useLabTake.ts, useLabCamera.ts, browserUrl.ts).
/** The facts of a lab URL that the tools and the packet show. */
export interface LabUrlFacts {
  readonly take: string | null;
  readonly t: number | null;
  readonly paused: boolean;
  /** The named camera, `view <text>` for a free view, or "overview". */
  readonly camera: string;
  readonly item: string | null;
  readonly tune: string | null;
  readonly debug: readonly string[];
  readonly source: string;
  readonly worker: boolean;
  readonly rec: boolean;
}

/**
 * The URL of a frame without the `workbench` parameter of the bridge (the parameter only enables the bridge) and
 * without the per-process secret of the lab server (`labsKey`).
 */
export function shownUrl(url: string): string {
  let out = url;
  for (;;) {
    const next = out.replace(/([?&])(?:workbench|labsKey)=[^&#]*(&?)/, (_match, separator: string, after: string) =>
      after === "&" ? separator : "",
    );
    if (next === out) return out;
    out = next;
  }
}

/** Read the facts of a lab URL. A text that is not a URL gives the defaults. */
export function labUrlFacts(url: string | null): LabUrlFacts {
  let params = new URLSearchParams();
  try {
    if (url !== null) params = new URL(url).searchParams;
  } catch {
    // The defaults apply.
  }
  const t = Number(params.get("t"));
  const view = params.get("view");
  return {
    take: params.get("take") ?? params.get("preset"),
    t: params.has("t") && Number.isFinite(t) ? t : null,
    paused: params.get("paused") === "1" || params.has("freeze"),
    camera: params.get("camera") ?? (view === null ? "overview" : `view ${view}`),
    item: params.get("item"),
    tune: params.get("tune"),
    debug: (params.get("debug") ?? "").split(",").filter((layer) => layer !== ""),
    source: params.get("source") ?? "take",
    worker: params.get("worker") !== "0",
    rec: params.has("rec"),
  };
}
