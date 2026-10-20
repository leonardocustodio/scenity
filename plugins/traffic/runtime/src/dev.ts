// SPDX-License-Identifier: Apache-2.0
/**
 * The metric face of the traffic plugin: the metrics of the plugin for the rules.
 * The editor page, the scene worker and `scenity check` add them to the metric registry of their rule check.
 *
 * - `traffic.vehicleGap`: the smallest distance (m) between the centres of two vehicles (`traffic.vehicle`) on the
 *   floor plane. Each pair is an item. A rule gives the gap as its `min`.
 *
 * The debug layer `traffic-gaps` of the View options of the editor draws a line between each two vehicles near the
 * floor. The line of the nearest two is red. The types of the layer are structural, so the plugin needs no dev package.
 */
import { z } from "zod";
import { defineMetric, type MetricPlugin } from "@scenity/rules";

export const vehicleGap = defineMetric({
  id: "traffic.vehicleGap",
  label: "Gap between vehicles",
  unit: "m",
  worst: "min",
  args: z.strictObject({
    /** The vehicles of the metric (default: each entity with the component `traffic.vehicle`). */
    vehicles: z.array(z.string().min(1)).min(2).optional(),
  }),
  evaluate(ctx, args) {
    const ids =
      args.vehicles ??
      ctx
        .entities()
        .filter((entity) => entity.components.includes("traffic.vehicle"))
        .map((entity) => entity.id);
    const at = ids.flatMap((id) => {
      const point = ctx.point(`entity:${id}`);
      return point === null ? [] : [{ id, point }];
    });
    if (at.length < 2) return { value: null, unit: "m", detail: "fewer than two vehicles" };
    const items = at.flatMap((a, index) =>
      at.slice(index + 1).map((b) => ({
        subject: `${a.id}+${b.id}`,
        value: Math.round(Math.hypot(a.point[0] - b.point[0], a.point[2] - b.point[2]) * 1000) / 1000,
      })),
    );
    const worst = items.reduce((low, item) => (item.value < low.value ? item : low));
    return { value: worst.value, unit: "m", detail: `${worst.subject}: ${String(worst.value)} m`, items };
  },
});

type Vec3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

/** What the layer reads of the scene layers of the dev core (`SceneLayerData` of @scenity/runtime-dev). */
interface LayerData {
  readonly builder: {
    entityIds(): string[];
    componentIds(id: string): string[];
    entityObject(id: string): { readonly matrixWorld: { readonly elements: ArrayLike<number> } } | undefined;
  };
}

/** The colours of the lines: a pair, and the nearest pair. */
const PAIR: Rgb = [0.2, 1, 0.3];
const NEAREST: Rgb = [1, 0.15, 0.15];
/** The height of the lines over the floor (m). */
const LIFT = 0.05;

/** The current floor places of the vehicles of the scene. */
export function vehiclePlaces(data: LayerData): Vec3[] {
  return data.builder.entityIds().flatMap((id) => {
    if (!data.builder.componentIds(id).includes("traffic.vehicle")) return [];
    const world = data.builder.entityObject(id)?.matrixWorld.elements;
    return world === undefined ? [] : [[world[12] ?? 0, LIFT, world[14] ?? 0] as const];
  });
}

/** The layer of the gaps between the vehicles. */
export const gapsLayer = {
  name: "traffic-gaps",
  label: "Traffic gaps",
  order: 70,
  scene(draw: { line(from: Vec3, to: Vec3, color: Rgb): void }, _input: unknown, data: LayerData): void {
    const at = vehiclePlaces(data);
    const pairs = at.flatMap((a, index) => at.slice(index + 1).map((b) => [a, b] as const));
    const gap = ([a, b]: readonly [Vec3, Vec3]): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
    const nearest = pairs.reduce<readonly [Vec3, Vec3] | null>(
      (low, pair) => (low === null || gap(pair) < gap(low) ? pair : low),
      null,
    );
    for (const pair of pairs) draw.line(pair[0], pair[1], pair === nearest ? NEAREST : PAIR);
  },
};

/** The dev face: the plugin ID, its metric library and its debug layer. */
const trafficDev: MetricPlugin & { readonly layers: readonly (typeof gapsLayer)[] } = {
  id: "traffic",
  library: [vehicleGap],
  layers: [gapsLayer],
};
export default trafficDev;
