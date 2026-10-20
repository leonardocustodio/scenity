// SPDX-License-Identifier: Apache-2.0
/**
 * The layer face of the dev tools. A debug layer is a named drawer of lines and points over the scene. A dev plugin
 * gives its own layers and metrics through `defineDevPlugin`. The dev core draws the layers that are on in one pass
 * (debugLayers.ts), in the order of their `order` values.
 *
 * - A name is the word of the URL parameter `debug` and of `lab.debug([...])`. Two layers can have the same name (the
 *   skeleton of the figures and the skeleton of the scene models): the name shows both.
 * - The draw has three stages. First the `scene` draws of the layers with an order under `FIGURE_ORDER`. Then, for
 *   each figure, the `figure` draws of each layer. Then the `scene` draws of the other layers. So the lines of the
 *   layers keep one order from frame to frame, and the debug shots of a plugin do not change when a layer moves into
 *   the plugin.
 * - The generic layers (`GENERIC_LAYERS`) have no domain. A plugin layer reads the data that its core gives
 *   (`bindDevPlugin`).
 */
import type { Vec3 } from "@scenity/character/math";
import type { FloorPoint } from "@scenity/character/path";
import type { FloorRect, HandGoal } from "@scenity/character/place";
import type { MetricDefinition } from "@scenity/rules";
import type { Joints } from "./inspect";
import type { MetricValue } from "./metrics";

/** The names of the generic debug layers. */
export const GENERIC_LAYERS = [
  "bounds",
  "sockets",
  "obstacles",
  "paths",
  "skeleton",
  "wireframe",
  "normals",
  "lights",
  "cameras",
] as const;
export type GenericLayer = (typeof GENERIC_LAYERS)[number];

/** A layer with an order under this value draws its scene part before the figures. */
export const FIGURE_ORDER = 50;

export type Rgb = readonly [number, number, number];

/** The colours of the layers. */
export const DEBUG_COLORS = {
  stands: [0.2, 0.9, 1],
  obstacles: [1, 0.55, 0.1],
  paths: [1, 0.9, 0.1],
  near: [0.2, 1, 0.3],
  far: [1, 0.15, 0.15],
  points: [1, 0.2, 0.9],
  white: [1, 1, 1],
  bounds: [0.35, 1, 0.45],
  sockets: [0.3, 0.6, 1],
  normals: [0.5, 0.75, 1],
  lights: [1, 0.85, 0.35],
  cameras: [0.85, 0.6, 1],
} as const satisfies Readonly<Record<string, Rgb>>;

/** The height of the floor lines over the floor (metres). */
export const FLOOR = 0.015;

/** A stand point on the floor (x, z) and the floor point that it faces. */
export interface DebugAnchor {
  readonly at: readonly [number, number];
  readonly face: readonly [number, number];
}

/** A drawn figure: the goals of its two hands (left, right; absent: no goals) and its joints after the IK. */
export interface DebugFigure {
  readonly hands?: readonly [HandGoal, HandGoal];
  joints(): Joints;
}

/** The generic data of a frame for the debug layers (the core gives it). */
export interface DebugInput {
  /** The floor rectangles that a walk goes around. */
  readonly obstacles: Iterable<FloorRect>;
  /** The stand points of the scene (the obstacles layer draws them). Absent: none. */
  readonly stands?: Iterable<DebugAnchor>;
  /** The current walks on the floor. */
  readonly walks: Iterable<{ readonly path: readonly FloorPoint[] } | null>;
  /** The lines of the `path` components in the world frame (the paths layer draws them). Absent: none. */
  readonly routes?: Iterable<readonly Vec3[]>;
  readonly figures: Iterable<DebugFigure>;
  /** The work points of the scene (a plugin layer draws them). */
  readonly points: Iterable<Vec3>;
}

/** No data: the debug layers of a core without a plugin input draw nothing. */
export const NO_DEBUG_INPUT: DebugInput = { obstacles: [], walks: [], figures: [], points: [] };

/** The pen of the layers: line segments and points, each with a colour. */
export interface DebugDraw {
  line(from: Vec3, to: Vec3, color: Rgb): void;
  point(at: Vec3, color: Rgb): void;
}

/** A debug layer. `Data` is the data that the core of the plugin gives the layer at each draw. */
export interface DevLayer<Data = unknown> {
  readonly name: string;
  /** The text of the layer in a layer menu. Default: the name. */
  readonly label?: string;
  /** The place in the draw order: lower first. The generic layers use 20 to 90. */
  readonly order: number;
  /** Draw the parts of the scene. */
  scene?(draw: DebugDraw, input: DebugInput, data: Data): void;
  /** Draw the parts of one figure. The dev core calls it for each figure, in the order of the figures. */
  figure?(draw: DebugDraw, figure: DebugFigure, data: Data): void;
}

/** The metrics of a dev plugin: the names in the order of the values, and the values of one inspect report. */
export interface DevMetrics<Report, Kit> {
  readonly names: readonly string[];
  measure(report: Report, kit: Kit): readonly MetricValue[];
}

/** The dev face of a plugin: its debug layers and its metrics. */
export interface DevPlugin<Data = unknown, Report = never, Kit = void> {
  /** The plugin ID (the ID of its runtime face). */
  readonly id: string;
  readonly layers: readonly DevLayer<Data>[];
  readonly metrics?: DevMetrics<Report, Kit>;
  /**
   * The metrics of the plugin for the metric library of `@scenity/rules` (`defineMetric`). A host adds them to its
   * registry with `registry.use(plugin)`. Each ID starts with the plugin ID and a dot (`<plugin>.<name>`), as each part
   * ID of the runtime face.
   */
  readonly library?: readonly MetricDefinition[];
}

/** A layer with the function that gives its current data (the core of the plugin binds it). */
export interface BoundLayer {
  readonly layer: DevLayer<never>;
  data(): unknown;
}

/**
 * Make the dev face of a plugin. A layer needs a name and at least one draw; a metric name and a library metric come
 * one time only.
 */
export function defineDevPlugin<Data = unknown, Report = never, Kit = void>(
  spec: DevPlugin<Data, Report, Kit>,
): DevPlugin<Data, Report, Kit> {
  for (const layer of spec.layers) {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(layer.name)) throw new Error(`${spec.id}: "${layer.name}" is not a layer name`);
    if (layer.scene === undefined && layer.figure === undefined) {
      throw new Error(`${spec.id}: the layer "${layer.name}" draws nothing`);
    }
  }
  const names = spec.metrics?.names ?? [];
  if (new Set(names).size !== names.length) throw new Error(`${spec.id}: a metric name is in the list two times`);
  const library = (spec.library ?? []).map((metric) => metric.id);
  if (new Set(library).size !== library.length)
    throw new Error(`${spec.id}: a library metric is in the list two times`);
  const outside = library.find((id) => !id.startsWith(`${spec.id}.`));
  if (outside !== undefined)
    throw new Error(`${spec.id}: the library metric "${outside}" does not start with "${spec.id}."`);
  return spec;
}

/** The layers of a plugin with the data function of its core. */
export function bindDevPlugin<Data>(
  plugin: { readonly layers: readonly DevLayer<Data>[] },
  data: () => Data,
): BoundLayer[] {
  return plugin.layers.map((layer) => ({ layer, data }));
}

/** The names of the layers in a list of bound layers, in the order of the list, each name one time. */
export function layerNames(layers: readonly BoundLayer[]): string[] {
  return [...new Set(layers.map((bound) => bound.layer.name))];
}

/** A cross and a line of 0.3 m to the facing of a stand point, on the floor. */
export function drawStand(draw: DebugDraw, slot: DebugAnchor, color: Rgb): void {
  const [x, z] = slot.at;
  const dx = slot.face[0] - x;
  const dz = slot.face[1] - z;
  const length = Math.hypot(dx, dz) || 1;
  draw.line([x - 0.06, FLOOR, z], [x + 0.06, FLOOR, z], color);
  draw.line([x, FLOOR, z - 0.06], [x, FLOOR, z + 0.06], color);
  draw.line([x, FLOOR, z], [x + (dx / length) * 0.3, FLOOR, z + (dz / length) * 0.3], color);
}

const BOX_EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7] as const;

/** The 12 edges of a box with the axes of the world. */
export function drawBox(draw: DebugDraw, min: Vec3, max: Vec3, color: Rgb): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  for (let i = 0; i < BOX_EDGES.length; i += 2) {
    const a = c[BOX_EDGES[i] ?? 0];
    const b = c[BOX_EDGES[i + 1] ?? 0];
    if (a !== undefined && b !== undefined) draw.line(a, b, color);
  }
}

/** A small cross of three lines at a point. */
export function drawCross(draw: DebugDraw, at: Vec3, size: number, color: Rgb): void {
  const [x, y, z] = at;
  draw.line([x - size, y, z], [x + size, y, z], color);
  draw.line([x, y - size, z], [x, y + size, z], color);
  draw.line([x, y, z - size], [x, y, z + size], color);
}
