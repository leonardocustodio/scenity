// SPDX-License-Identifier: Apache-2.0
/**
 * The frame tools of the workbench: `lab_frame` goes to a frame and
 * gives its picture and its metrics. It drives the lab page through the surface bridge with the calls of the lab
 * script API (useLabApi.ts). The inspect tool is a tool of a host plugin (plugin.ts). It uses `goToFrame` and
 * `timeInput` of this module.
 */
import { z } from "zod";
import { captureArgs } from "../hostProtocol";
import type { Capture } from "../protocol";
import type { SurfacePort } from "./context";
import { changesScene, frameFromIndex, indexInputAt, keepFrame } from "./indexTools";
import { nativeLine, nativeShot } from "./nativeShot";
import {
  call,
  captureOf,
  cut,
  defineTool,
  FRAME_TIMEOUT_MS,
  fmt,
  frameUrl,
  imageContent,
  labUrlFacts,
  list,
  number,
  portOf,
  record,
  shownUrl,
  text,
  type ToolResult,
} from "./kit";

/** The debug layers of the lab (`DEBUG_LAYERS` of the lab). */
export const DEBUG_LAYERS = ["anchors", "obstacles", "paths", "ik", "points", "frame", "skeleton"] as const;
/** The largest width of a picture of a tool: 1280 px on the long side. */
export const MAX_IMAGE_WIDTH = 1280;

export const whereInput = z
  .enum(["visible", "shadow"])
  .optional()
  .describe("The frame: 'visible' (the frame the owner sees, the default) or 'shadow' (a hidden frame).");
export const timeInput = z.number().int().min(0).describe("A time of the take in ms. The clock stops at that time.");

/** Where a tool goes before it reads a frame. */
export interface FrameTarget {
  readonly take?: string | undefined;
  readonly item?: string | undefined;
  readonly rec?: readonly Record<string, unknown>[] | undefined;
  readonly tune?: Readonly<Record<string, number | null>> | undefined;
  readonly debug?: readonly string[] | undefined;
  readonly camera?: string | undefined;
  readonly t?: number | undefined;
}

/**
 * Go to a frame: load the take, open the item, set the events, the tunes, the debug layers and the camera, stop the
 * clock at the time, then wait for the frame. Give the time of the drawn frame.
 */
export async function goToFrame(port: SurfacePort, target: FrameTarget): Promise<number | null> {
  if (target.take !== undefined) await call(port, "load", [target.take]);
  if (target.item !== undefined) {
    const opened = await call(port, "open", [target.item, { play: false }]);
    if (opened === false) throw new Error(`open: the item "${target.item}" has no scene in the lab.`);
  }
  if (target.rec !== undefined) await call(port, "setEvents", [target.rec]);
  for (const [path, value] of Object.entries(target.tune ?? {})) await call(port, "tune", [path, value]);
  if (target.debug !== undefined) await call(port, "debug", [target.debug]);
  if (target.camera !== undefined) await call(port, "camera", [target.camera]);
  if (target.t !== undefined) {
    await call(port, "pause");
    await call(port, "seek", [target.t]);
  }
  const frame = record(await call(port, "frame", [], FRAME_TIMEOUT_MS));
  return number(frame.simMs);
}

/** The lines of the metrics of a frame: one line per member, at most 8 values each. */
export function metricLines(values: readonly unknown[], maxMembers = 6): string[] {
  const byMember = new Map<string, string[]>();
  for (const value of values) {
    const item = record(value);
    const metric = text(item.metric);
    const amount = number(item.value);
    if (metric === null || amount === null) continue;
    const member = text(item.member) ?? "scene";
    const unit = text(item.unit) ?? "";
    const entries = byMember.get(member) ?? [];
    entries.push(`${metric} ${fmt(amount)}${unit === "" ? "" : ` ${unit}`}`);
    byMember.set(member, entries);
  }
  const rows = [...byMember.entries()];
  return cut(
    rows,
    maxMembers,
    ([member, entries]) => `  ${member}: ${entries.slice(0, 8).join(", ")}${entries.length > 8 ? ", …" : ""}`,
  );
}

const frameInput = z.object({
  t: timeInput.optional(),
  camera: z.string().optional().describe("A named camera of the lab, for example 'overview'."),
  item: z.string().optional().describe("Open an item of the content browser first: its key (lab_browse gives keys)."),
  take: z.string().optional().describe("Load a take (a sequence of the project) first, by its name."),
  rec: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("The events of the panel after the take (the lab API setEvents)."),
  tune: z
    .record(z.string(), z.number().nullable())
    .optional()
    .describe("Tune values to set first: path to number; null puts the default back."),
  debug: z.array(z.enum(DEBUG_LAYERS)).optional().describe("The debug layers over the scene (an empty list: none)."),
  where: whereInput,
  width: z.number().int().min(64).max(MAX_IMAGE_WIDTH).optional().describe("The width of the picture in px."),
  source: z
    .enum(["canvas", "window"])
    .optional()
    .describe(
      "The picture: 'canvas' (the frame of the scene, the default) or 'window' (a native snapshot of what " +
        "the owner sees in the labs app, cards and overlays included; a browser gives the canvas picture).",
    ),
  pane: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("With the split screen of the lab, the picture of one pane (0 is the main pane, the default)."),
  grid: z
    .boolean()
    .optional()
    .describe("With the split screen of the lab, one picture of all the panes from the same frame."),
  onion: z
    .boolean()
    .optional()
    .describe(
      "The onion skin in the picture: faint copies of the members (the selected member, else the team) " +
        "before (blue) and after (orange) the time, from the pose model. Stops the clock. Default: no onion skin.",
    ),
  onionStep: z.number().int().min(50).max(2000).optional().describe("The ms between two copies (default 250)."),
  onionCount: z.number().int().min(1).max(3).optional().describe("The copies on each side of the time (default 2)."),
  hidden: z
    .boolean()
    .optional()
    .describe(
      "True draws the picture with the solo and hide of its pane (H, Shift+H in the lab); default: every " +
        "item shows. The frame index never hides.",
    ),
});

/** The onion skin of a frame: the change of the lab API `onion`, or null without `onion`. */
function onionChange(input: z.infer<typeof frameInput>): Record<string, unknown> | null {
  if (input.onion !== true) return null;
  return {
    on: true,
    ...(input.onionStep === undefined ? {} : { step: input.onionStep }),
    ...(input.onionCount === undefined ? {} : { count: input.onionCount }),
  };
}

/** The line of the onion skin of a picture. */
function onionLine(state: Record<string, unknown>): string {
  const step = number(state.step) ?? 250;
  const count = number(state.count) ?? 2;
  return `Onion skin: ${String(count)} copies on each side, ${String(step)} ms apart (blue before, orange after).`;
}

/** The pane or the grid of a capture, or null for the main pane. */
function paneTarget(input: { pane?: number | undefined; grid?: boolean | undefined }): Record<string, unknown> | null {
  if (input.grid === true) return { grid: true };
  return input.pane === undefined ? null : { pane: input.pane };
}

/** The target of a capture: the pane or the grid, the onion skin and the hide of the pane. */
function captureTarget(input: {
  pane?: number | undefined;
  grid?: boolean | undefined;
  onion?: boolean | undefined;
  hidden?: boolean | undefined;
}): Record<string, unknown> | null {
  const target = paneTarget(input);
  if (input.onion !== true && input.hidden !== true) return target;
  return {
    ...(target ?? {}),
    ...(input.onion === true ? { onion: true } : {}),
    ...(input.hidden === true ? { hidden: true } : {}),
  };
}

/** The picture of `lab_frame`: the canvas capture, or the native snapshot of the window. */
async function framePicture(
  port: SurfacePort,
  input: {
    width?: number | undefined;
    source?: "canvas" | "window" | undefined;
    where?: string | undefined;
    pane?: number | undefined;
    grid?: boolean | undefined;
    onion?: boolean | undefined;
    hidden?: boolean | undefined;
  },
): Promise<{ shot: Capture; line: string | null }> {
  const width = input.width ?? MAX_IMAGE_WIDTH;
  if (input.source === "window" && input.where !== "shadow") {
    const native = await nativeShot(port, width);
    if (native !== null) return { shot: native.shot, line: nativeLine(native) };
  }
  const target = captureTarget(input);
  const args = target === null ? captureArgs(width) : [...captureArgs(width), target];
  const shot = captureOf(await call(port, "capture", args, FRAME_TIMEOUT_MS));
  const line =
    input.source === "window" ? "No native snapshot here (a browser, or a hidden frame): canvas picture." : null;
  return { shot, line };
}

export const labFrame = defineTool({
  name: "lab_frame",
  description:
    "Go to a frame of the 3D room lab and look at it: optionally load a take, open an item, set the events, the " +
    "tunes, the debug layers and the camera, and stop the clock at a time. Gives the URL of the frame, its time, " +
    "the motion metrics of each member and one picture (WebP, at most 1280 px). With the split screen of the lab " +
    "(`panes` in the URL), `pane` gives one pane and `grid` all the panes; the default is the main pane. `onion` " +
    "adds the onion skin (the poses before and after the time) to the picture.",
  input: frameInput,
  alwaysLoad: true,
  async handler(input, ctx): Promise<ToolResult> {
    const port = portOf(ctx, input.where);
    // A canvas frame at a time of the current scene comes from the frame index first (indexTools.ts).
    const width = input.width ?? MAX_IMAGE_WIDTH;
    // The index keeps only the main view: a pane or the grid of the split screen, the onion skin and the hide of a
    // pane are not in it.
    const split = paneTarget(input) !== null || input.onion === true || input.hidden === true;
    const indexed = input.t !== undefined && input.source !== "window" && !changesScene(input) && !split;
    const keyInput = indexed && input.t !== undefined ? await indexInputAt(ctx, input.t, input.camera) : null;
    const hit = await frameFromIndex(ctx, keyInput, width);
    if (hit !== null) return indexFrameResult(port, input, hit, width);
    const simMs = await goToFrame(port, input);
    const metrics = list(await call(port, "measure", [], FRAME_TIMEOUT_MS));
    // The onion skin needs a stopped clock. The onion skin of the lab returns to its old state after the picture.
    const change = onionChange(input);
    if (change !== null) await call(port, "pause");
    const onion = change === null ? null : record(await call(port, "onion", [change]));
    let picture: Awaited<ReturnType<typeof framePicture>>;
    try {
      picture = await framePicture(port, input);
    } finally {
      if (onion !== null) await call(port, "onion", [record(onion.before)]);
    }
    const { shot, line } = picture;
    if (keyInput !== null && line === null && simMs === input.t) await keepFrame(ctx, keyInput, shot, metrics);
    const url = shownUrl(await frameUrl(port));
    const facts = labUrlFacts(url);
    const at = simMs === null ? "?" : String(simMs);
    const lines = [
      `Frame at ${at} ms · take ${facts.take ?? "idle"} · camera ${facts.camera} · ${input.where ?? "visible"} frame`,
      `URL: ${url}`,
      metrics.length === 0 ? "Metrics: none (the frame has no members)." : `Metrics (${String(metrics.length)}):`,
      ...metricLines(metrics),
      `Picture: ${String(shot.width)}×${String(shot.height)} ${shot.mime}.`,
      ...(line === null ? [] : [line]),
      ...(onion === null ? [] : [onionLine(onion)]),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }, imageContent(shot)] };
  },
});

/**
 * The answer of a `lab_frame` hit of the frame index: the visible frame still goes to the time and the camera
 * (no wait for its draw), so the owner sees the same moment. The picture and the metrics come from the index.
 */
async function indexFrameResult(
  port: SurfacePort,
  input: { readonly t?: number | undefined; readonly camera?: string | undefined; readonly where?: string | undefined },
  hit: NonNullable<Awaited<ReturnType<typeof frameFromIndex>>>,
  width: number,
): Promise<ToolResult> {
  if (input.camera !== undefined) await call(port, "camera", [input.camera]);
  await call(port, "pause");
  await call(port, "seek", [hit.simMs]);
  const url = shownUrl(await frameUrl(port));
  const facts = labUrlFacts(url);
  const lines = [
    `Frame at ${String(hit.simMs)} ms · take ${facts.take ?? "idle"} · camera ${facts.camera} · from the frame index`,
    `URL: ${url}`,
    hit.metrics.length === 0 ? "Metrics: none (the frame has no members)." : `Metrics (${String(hit.metrics.length)}):`,
    ...metricLines(hit.metrics),
    `Picture: ${String(width)}×${String(Math.round(width / 1.6))} ${hit.mime}.`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }, imageContent({ bytes: hit.bytes, mime: hit.mime })] };
}
