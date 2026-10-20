// SPDX-License-Identifier: Apache-2.0
/**
 * The debug layers of the 3D scene (dev only): lines and points over the scene from the data that the core already
 * has. The lab enables them (URL `debug`, the View tab, the script API); a case never does. The core gives the data of
 * a frame as plain shapes (`DebugInput`). The layers are drawers (devLayers.ts). The generic drawers are here, and a
 * dev plugin adds its own drawers (`DebugLayers.register`).
 *
 * - obstacles: the floor rectangles that a walk goes around (orange), and the stand points with their facing (cyan)
 * - paths: the current walks on the floor and the lines of the `path` components (yellow)
 * - skeleton: lines between the joints of each figure (white): the bones of a glTF character, else the graybox body
 *
 * The scene of a document core adds bounds, sockets, the skeleton of its models, normals, light and camera helpers
 * (document/sceneLayers.ts) and the wireframe (document/wireframe.ts).
 */
import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Points, PointsMaterial } from "three";
import type { Vec3 } from "@scenity/character/math";
import type { JointName } from "./inspect";
import {
  DEBUG_COLORS,
  drawStand,
  FIGURE_ORDER,
  FLOOR,
  layerNames,
  type BoundLayer,
  type DebugDraw,
  type DebugInput,
  type DevLayer,
  type Rgb,
} from "./devLayers";

export type { DebugAnchor, DebugFigure, DebugInput } from "./devLayers";
export { NO_DEBUG_INPUT } from "./devLayers";

const BONES: readonly (readonly [JointName, JointName])[] = [
  ["pelvis", "head"],
  ["shoulder_l", "shoulder_r"],
  ["shoulder_l", "elbow_l"],
  ["elbow_l", "wrist_l"],
  ["shoulder_r", "elbow_r"],
  ["elbow_r", "wrist_r"],
  ["hip_l", "hip_r"],
  ["hip_l", "knee_l"],
  ["knee_l", "ankle_l"],
  ["hip_r", "knee_r"],
  ["knee_r", "ankle_r"],
];

/** A buffer of line segments or points with a colour per vertex. */
class Buffer {
  readonly positions: number[] = [];
  readonly colors: number[] = [];

  add(at: Vec3, color: Rgb): void {
    this.positions.push(at[0], at[1], at[2]);
    this.colors.push(color[0], color[1], color[2]);
  }

  into(geometry: BufferGeometry): void {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.computeBoundingSphere();
  }
}

/** The obstacles layer: the floor rectangles, then the stand points. */
const obstaclesLayer: DevLayer = {
  name: "obstacles",
  order: 20,
  scene(draw, input) {
    for (const rect of input.obstacles) {
      const corners: Vec3[] = [
        [rect.minX, FLOOR, rect.minZ],
        [rect.maxX, FLOOR, rect.minZ],
        [rect.maxX, FLOOR, rect.maxZ],
        [rect.minX, FLOOR, rect.maxZ],
      ];
      corners.forEach((corner, index) => {
        draw.line(corner, corners[(index + 1) % 4] ?? corner, DEBUG_COLORS.obstacles);
      });
    }
    for (const stand of input.stands ?? []) drawStand(draw, stand, DEBUG_COLORS.stands);
  },
};

/** The paths layer: the walks on the floor with a point at each end, then the `path` lines in the world. */
const pathsLayer: DevLayer = {
  name: "paths",
  order: 30,
  scene(draw, input) {
    for (const walk of input.walks) {
      if (walk === null) continue;
      walk.path.forEach((point, index) => {
        const next = walk.path[index + 1];
        if (next !== undefined) draw.line([point[0], FLOOR, point[1]], [next[0], FLOOR, next[1]], DEBUG_COLORS.paths);
      });
      const end = walk.path.at(-1);
      if (end !== undefined) draw.point([end[0], FLOOR, end[1]], DEBUG_COLORS.paths);
    }
    for (const route of input.routes ?? []) {
      route.forEach((point, index) => {
        const next = route[index + 1];
        if (next !== undefined) draw.line(point, next, DEBUG_COLORS.paths);
        draw.point(point, DEBUG_COLORS.paths);
      });
    }
  },
};

/** The skeleton layer of the figures: a line for each bone between two joints. */
const skeletonLayer: DevLayer = {
  name: "skeleton",
  order: 60,
  figure(draw, figure) {
    const joints = figure.joints();
    for (const [from, to] of BONES) {
      const a = joints[from];
      const b = joints[to];
      if (a !== undefined && b !== undefined) draw.line(a, b, DEBUG_COLORS.white);
    }
  },
};

/** The generic layers of the figures and the floor. */
export const GENERIC_DRAWERS: readonly BoundLayer[] = [obstaclesLayer, pathsLayer, skeletonLayer].map((layer) => ({
  layer,
  data: () => undefined,
}));

export class DebugLayers {
  readonly root = new Group();
  private readonly lines: LineSegments;
  private readonly points: Points;
  private layers: ReadonlySet<string> = new Set();
  /** The drawers in draw order: the generic drawers and the drawers of the plugins and of the core. */
  private drawers: BoundLayer[] = [...GENERIC_DRAWERS];
  /** The names that the core handles without a drawer (the wireframe of a document core). */
  private readonly extra: ReadonlySet<string>;

  constructor(extra: readonly string[] = []) {
    this.extra = new Set(extra);
    this.root.name = "debug-layers";
    // Over the scene: no depth test, drawn last.
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
    );
    this.points = new Points(
      new BufferGeometry(),
      new PointsMaterial({ vertexColors: true, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }),
    );
    this.lines.renderOrder = 1000;
    this.points.renderOrder = 1001;
    this.lines.frustumCulled = false;
    this.points.frustumCulled = false;
    this.root.add(this.lines, this.points);
    this.root.visible = false;
  }

  get active(): boolean {
    return this.layers.size > 0;
  }

  /** True when a layer with a drawer is on. The layers that the core handles without a drawer draw no lines. */
  get drawing(): boolean {
    return [...this.layers].some((layer) => !this.extra.has(layer));
  }

  /** Add drawers (of a plugin or of the core). The draw order comes from their `order` values. */
  register(drawers: readonly BoundLayer[]): void {
    // A stable sort: two drawers with the same order keep the order of their registration.
    this.drawers = [...this.drawers, ...drawers].sort((a, b) => a.layer.order - b.layer.order);
  }

  /** The names of the layers that this core can draw. */
  names(): string[] {
    return [...layerNames(this.drawers), ...this.extra];
  }

  /** True when the layer of the name is on. */
  has(name: string): boolean {
    return this.layers.has(name);
  }

  /** Show the layers of the names and hide the others. A name that this core cannot draw does nothing. */
  set(layers: readonly string[]): void {
    const known = new Set(this.names());
    this.layers = new Set(layers.filter((layer) => known.has(layer)));
    this.root.visible = this.layers.size > 0;
  }

  /** Build the lines and the points of the layers that are on, from the data of this frame. */
  draw(input: DebugInput): void {
    if (this.layers.size === 0) return;
    const lines = new Buffer();
    const points = new Buffer();
    const draw: DebugDraw = {
      line: (from, to, color) => {
        lines.add(from, color);
        lines.add(to, color);
      },
      point: (at, color) => {
        points.add(at, color);
      },
    };
    const on = this.drawers.filter((bound) => this.layers.has(bound.layer.name));
    const scene = (bound: BoundLayer) => bound.layer.scene?.(draw, input, bound.data() as never);
    on.filter((bound) => bound.layer.order < FIGURE_ORDER).forEach(scene);
    for (const figure of input.figures) {
      for (const bound of on) bound.layer.figure?.(draw, figure, bound.data() as never);
    }
    on.filter((bound) => bound.layer.order >= FIGURE_ORDER).forEach(scene);
    lines.into(this.lines.geometry);
    points.into(this.points.geometry);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.points.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
