// SPDX-License-Identifier: Apache-2.0
/**
 * The shared parts of the generic layout tools: the request and the result of a tool, the metric runs through the
 * registry of `@scenity/rules`, and the shapes of the overlay (lines, dots, labels in the world frame, as `OverlaySpec`
 * of overlay.ts). The tools are pure functions of a metric context: the editor page makes the context from the inspect
 * report, a test makes it with `builderMetricContext`.
 */
import {
  createMetricRegistry,
  type MetricContext,
  type MetricRegistry,
  type MetricResult,
  type PointArg,
  type Vec3,
} from "@scenity/rules";
import type { OverlayDot, OverlayLabel, OverlayLine, OverlaySpec, OverlayTone } from "../overlay";

/** The tools of the layout menu, in the order of the menu. */
export const LAYOUT_TOOL_IDS = ["measure", "reach", "clearance", "walk", "visibility"] as const;
export type LayoutToolId = (typeof LAYOUT_TOOL_IDS)[number];

/** What all tools read: the selected entities, in the order of the selection. */
export interface ToolBase {
  readonly selection?: readonly string[];
}

export interface MeasureRequest extends ToolBase {
  readonly tool: "measure";
  /** The ends: references or world points (two picks). Default: the first two selected entities. */
  readonly from?: PointArg;
  readonly to?: PointArg;
}

export interface ReachRequest extends ToolBase {
  readonly tool: "reach";
  /** The actor: an entity with a `character` component or a stand point. Default: the first such entity selected. */
  readonly entity?: string;
  /** The work point. Default: the next selected entity. */
  readonly target?: PointArg;
  /** The arm length (m). Default: the length of the arm bones, else REACH_DEFAULTS.arm. */
  readonly arm?: number;
  readonly side?: "left" | "right";
}

export interface ClearanceRequest extends ToolBase {
  readonly tool: "clearance";
  /** The entities to measure. Default: the selection. */
  readonly entities?: readonly string[];
  /** The neighbours within this gap (m) count. */
  readonly radius?: number;
  /** The most neighbours of each entity. */
  readonly count?: number;
  /** A gap under this width (m) is narrow: a person cannot walk through. */
  readonly walkway?: number;
  /** `floor`: the gap over the floor (default); `space`: the gap of the boxes in space. */
  readonly plane?: "floor" | "space";
}

export interface WalkRequest extends ToolBase {
  readonly tool: "walk";
  /** The walkers. Default: the selected entities with a `locomotion` component, else each walker of the scene. */
  readonly entities?: readonly string[];
  /** A floor path around the obstacles between two points, for a scene with no walker. */
  readonly from?: PointArg;
  readonly to?: PointArg;
  /** A solid nearer than this to a route counts for `routeClear` (m). */
  readonly margin?: number;
  /** A route narrower than this (m) is narrow. */
  readonly walkway?: number;
}

export interface VisibilityRequest extends ToolBase {
  readonly tool: "visibility";
  /** The eye. Default: the first of two selected entities (its head bone when it has one), else `viewpoint`. */
  readonly eye?: PointArg;
  /** The entity of the rectangle. Default: the last selected entity. */
  readonly target?: string;
  /** The middle of the rectangle. Default: the middle of the box of the target. */
  readonly at?: PointArg;
  /** The width and the height of the rectangle (m). Default: the box of the target on its X and Y axes. */
  readonly size?: readonly [number, number];
  readonly grid?: number;
  readonly occluders?: "bounds" | "meshes";
  /** The place of the camera that draws: the eye when the request gives no other. */
  readonly viewpoint?: Vec3 | null;
}

export type LayoutToolRequest = MeasureRequest | ReachRequest | ClearanceRequest | WalkRequest | VisibilityRequest;

/** One metric that a tool ran: its arguments and its result, or the reason of a refusal. */
export interface ToolMetric {
  readonly metric: string;
  readonly args: unknown;
  readonly result: MetricResult | null;
  readonly error?: string;
}

/** The result of a tool: the readout, the metrics and the shapes of the overlay. */
export interface LayoutToolResult {
  readonly tool: LayoutToolId;
  /** False when the tool has no input; `reason` says why. */
  readonly ok: boolean;
  readonly reason: string | null;
  /** The entities that the tool measured. */
  readonly subjects: readonly string[];
  readonly metrics: readonly ToolMetric[];
  /** The readout: one line per measure. */
  readonly lines: readonly string[];
  readonly overlay: OverlaySpec;
}

/** The metric registry of the tools: the built-in metrics. */
let builtins: MetricRegistry | null = null;

export function toolRegistry(): MetricRegistry {
  builtins ??= createMetricRegistry();
  return builtins;
}

/** Run a metric; a refusal of the arguments gives the reason. */
export function runMetric(ctx: MetricContext, metric: string, args: unknown): ToolMetric {
  const outcome = toolRegistry().evaluate(metric, ctx, args);
  return outcome.ok ? { metric, args, result: outcome.result } : { metric, args, result: null, error: outcome.reason };
}

/** A result with no input: the reason says what the tool needs. */
export function noInput(tool: LayoutToolId, reason: string): LayoutToolResult {
  return { tool, ok: false, reason, subjects: [], metrics: [], lines: [reason], overlay: emptyShapes() };
}

/** The shapes of a tool while it adds them. */
export interface Shapes {
  readonly lines: OverlayLine[];
  readonly dots: OverlayDot[];
  readonly labels: OverlayLabel[];
}

export function emptyShapes(): Shapes {
  return { lines: [], dots: [], labels: [] };
}

/** The text of a length: `1.23 m` from 1 m, else `45.0 cm`. */
export function lengthText(metres: number): string {
  return Math.abs(metres) >= 1 ? `${metres.toFixed(2)} m` : `${(metres * 100).toFixed(1)} cm`;
}

/** The reference of an entity. */
export const entityRef = (id: string): string => `entity:${id}`;

/** The entity ID of a reference (`entity:<id>#<sub>`), or null for a world point. */
export function refEntity(at: PointArg): string | null {
  if (typeof at !== "string" || !at.startsWith("entity:")) return null;
  const rest = at.slice("entity:".length);
  const hash = rest.indexOf("#");
  return hash < 0 ? rest : rest.slice(0, hash);
}

/** The words of a point argument: the reference, or the point to 1 cm. */
export function pointWords(at: PointArg): string {
  return typeof at === "string" ? at : `(${at.map((value) => value.toFixed(2)).join(", ")})`;
}

/** The middle of two points. */
export function middle(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** The count of the segments of a ring. */
const RING_SEGMENTS = 48;

/** A ring of points about a centre in the plane of two unit directions. */
export function ring(center: Vec3, radius: number, u: Vec3, v: Vec3): Vec3[] {
  return Array.from({ length: RING_SEGMENTS }, (_, index): Vec3 => {
    const angle = (index / RING_SEGMENTS) * 2 * Math.PI;
    const [c, s] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    return [center[0] + u[0] * c + v[0] * s, center[1] + u[1] * c + v[1] * s, center[2] + u[2] * c + v[2] * s];
  });
}

/** The 12 edges of a box as lines. */
export function boxLines(box: { readonly min: Vec3; readonly max: Vec3 }, tone: OverlayTone): OverlayLine[] {
  const { min, max } = box;
  const corner = (x: number, y: number, z: number): Vec3 => [
    x === 0 ? min[0] : max[0],
    y === 0 ? min[1] : max[1],
    z === 0 ? min[2] : max[2],
  ];
  const bottom = [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)];
  const top = [corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1)];
  const posts = bottom.map((point, index) => ({ points: [point, top[index] ?? point], tone }));
  return [{ points: bottom, tone, closed: true }, { points: top, tone, closed: true }, ...posts];
}
