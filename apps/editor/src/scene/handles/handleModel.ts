// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of the components in the Scene view: a handle is a point of the world that a
 * drag moves, and each place of the handle gives a new value of one field of a component. The wires show the shape of
 * the value (the line to a target, the box of a shadow camera, the box of a safe frame). Each provider gives the
 * handles of one kind of value; handleProviders.ts adds more providers. Pure functions, no DOM.
 *
 * - `pointOrEntity` (`light.target`, `camera.target`): a point target has a handle that moves in the plane of the
 *   view. An entity target has a wire to the entity. With no target, a ghost handle 2 m in front of the entity sets a
 *   point target.
 * - `shadowCamera` (a directional light with a shadow): the box of the shadow camera in the frame of the light. A
 *   handle on each side moves that side along its axis (`left`, `right`, `top`, `bottom`, `near`, `far`).
 * - `safeFrame` (a camera): the corners `min` and `max` of the box in the world move in the plane of the view.
 */
import {
  qconjugate,
  qrotate,
  vadd,
  vcross,
  vdot,
  vlength,
  vnormalize,
  vscale,
  vsub,
  type Vec3,
} from "@scenity/scene/math";
import { parseRef } from "@scenity/scene/refs";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";

/** A handle of a field of a component. */
export interface ComponentHandle {
  /** `<component>.<field>`: the field that the handle changes (dots between the parts). */
  readonly id: string;
  readonly entity: string;
  readonly component: string;
  readonly field: string;
  /** The place of the handle in the world. */
  readonly at: Vec3;
  /** The line that the handle moves on (a world direction through `at`), or null: a plane through `at`. */
  readonly axis: Vec3 | null;
  /** The normal of the plane that the handle moves in (the ground: up); absent: the plane of the view. */
  readonly plane?: Vec3;
  /** The value of the field with no item of the handle (Alt and a press remove a path point). */
  readonly remove?: () => unknown;
  /** True for a handle of a value that is not there yet (a drag sets it). */
  readonly ghost?: boolean;
  /** The new value of the field for a place of the handle. */
  value(world: Vec3): unknown;
}

/** A line of points in the world (closed: a loop). */
export interface HandleWire {
  readonly points: readonly Vec3[];
  readonly closed?: boolean;
}

/** The handles and the wires of an entity. */
export interface HandleSet {
  readonly handles: readonly ComponentHandle[];
  readonly wires: readonly HandleWire[];
}

/** A provider of the handles of one kind of value of an entity. */
export type HandleProvider = (doc: SceneDocument, id: string) => HandleSet | null;

/** The distance of the ghost target in front of an entity (metres). */
const GHOST_DISTANCE = 2;
/** The values of the shadow camera of a directional light of three.js, for a field that the value does not give. */
export const SHADOW_CAMERA_DEFAULTS = { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 500 } as const;

export const round = (value: number): number => Math.round(value * 1000) / 1000;
export const roundPoint = (point: Vec3): Vec3 => [round(point[0]), round(point[1]), round(point[2])];

export function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number");
}

export function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The world point of a target value: a point, or the place of the entity of a reference; null for none. */
function targetPoint(doc: SceneDocument, target: unknown): Vec3 | null {
  if (isVec3(target)) return target;
  const ref = typeof target === "string" ? parseRef(target) : undefined;
  return ref?.kind === "entity" ? (worldTransform(doc, ref.id)?.position ?? null) : null;
}

/** The kinds of light that point at a target. */
const AIMED_LIGHTS = new Set(["directional", "spot"]);

/** The handles of the targets of a light and of a camera. */
export const targetHandles: HandleProvider = (doc, id) => {
  const entity = doc.entities[id];
  const world = worldTransform(doc, id);
  if (entity === undefined || world === undefined) return null;
  const handles: ComponentHandle[] = [];
  const wires: HandleWire[] = [];
  for (const component of ["light", "camera"]) {
    const value = record(entity.components[component]);
    if (value === null || (component === "light" && !AIMED_LIGHTS.has(String(value.type)))) continue;
    const target = value.target;
    const point = targetPoint(doc, target);
    if (point !== null) wires.push({ points: [world.position, point] });
    // An entity target moves with its entity: it has no handle.
    if (typeof target === "string") continue;
    const ghost = point === null;
    const at = point ?? vadd(world.position, vscale(qrotate(world.rotation, [0, 0, -1]), GHOST_DISTANCE));
    handles.push({
      id: `${component}.target`,
      entity: id,
      component,
      field: "target",
      at,
      axis: null,
      ...(ghost ? { ghost } : {}),
      value: roundPoint,
    });
  }
  return { handles, wires };
};

/**
 * The frame of an entity that looks at a target (a directional or spot light, a camera): its place and its axes (it
 * looks along `forward`; with no target, along -Z of the entity).
 */
export function aimFrame(doc: SceneDocument, id: string, target: unknown) {
  const world = worldTransform(doc, id);
  if (world === undefined) return null;
  const point = targetPoint(doc, target);
  const forward = point === null ? qrotate(world.rotation, [0, 0, -1]) : vnormalize(vsub(point, world.position));
  // The axes of a three.js look at: the up of the world, else the back of the world for a light straight down.
  const back = vscale(forward, -1);
  let right = vcross([0, 1, 0], back);
  if (vlength(right) < 1e-6) right = vcross([0, 0, -1], back);
  right = vnormalize(right);
  const up = vcross(back, right);
  return { origin: world.position, right, up, forward };
}

/** The handles of the box of the shadow camera of a directional light with a shadow. */
export const shadowCameraHandles: HandleProvider = (doc, id) => {
  const light = record(doc.entities[id]?.components.light);
  const box = record(light?.shadowCamera);
  if (light === null || box === null || light.type !== "directional" || light.shadow !== true) return null;
  const frame = aimFrame(doc, id, light.target);
  if (frame === null) return null;
  const side = (key: keyof typeof SHADOW_CAMERA_DEFAULTS): number =>
    typeof box[key] === "number" ? box[key] : SHADOW_CAMERA_DEFAULTS[key];
  const { origin, right, up, forward } = frame;
  const at = (x: number, y: number, depth: number): Vec3 =>
    vadd(origin, vadd(vscale(right, x), vadd(vscale(up, y), vscale(forward, depth))));
  const [left, rightSide, top, bottom, near, far] = [
    side("left"),
    side("right"),
    side("top"),
    side("bottom"),
    side("near"),
    side("far"),
  ];
  const middle = { x: (left + rightSide) / 2, y: (top + bottom) / 2, depth: (near + far) / 2 };
  const along = (axis: Vec3) => (world: Vec3) => round(vdot(vsub(world, origin), axis));
  const handle = (field: string, place: Vec3, axis: Vec3): ComponentHandle => ({
    id: `light.shadowCamera.${field}`,
    entity: id,
    component: "light",
    field: `shadowCamera.${field}`,
    at: place,
    axis,
    value: along(axis),
  });
  const rectangle = (depth: number): HandleWire => ({
    points: [at(left, bottom, depth), at(rightSide, bottom, depth), at(rightSide, top, depth), at(left, top, depth)],
    closed: true,
  });
  const corners: [number, number][] = [
    [left, bottom],
    [rightSide, bottom],
    [rightSide, top],
    [left, top],
  ];
  return {
    handles: [
      handle("left", at(left, middle.y, middle.depth), right),
      handle("right", at(rightSide, middle.y, middle.depth), right),
      handle("top", at(middle.x, top, middle.depth), up),
      handle("bottom", at(middle.x, bottom, middle.depth), up),
      handle("near", at(middle.x, middle.y, near), forward),
      handle("far", at(middle.x, middle.y, far), forward),
    ],
    wires: [rectangle(near), rectangle(far), ...corners.map(([x, y]) => ({ points: [at(x, y, near), at(x, y, far)] }))],
  };
};

/** The edges of a box of the world from its corners. */
export function boxWires(min: Vec3, max: Vec3): HandleWire[] {
  const corner = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const loop = (y: number): HandleWire => ({
    points: [
      corner(min[0], y, min[2]),
      corner(max[0], y, min[2]),
      corner(max[0], y, max[2]),
      corner(min[0], y, max[2]),
    ],
    closed: true,
  });
  const posts = [
    [min[0], min[2]],
    [max[0], min[2]],
    [max[0], max[2]],
    [min[0], max[2]],
  ].map(([x = 0, z = 0]) => ({ points: [corner(x, min[1], z), corner(x, max[1], z)] }));
  return [loop(min[1]), loop(max[1]), ...posts];
}

/** The handles of the corners of the box of the safe frame of a camera. */
export const safeFrameHandles: HandleProvider = (doc, id) => {
  const frame = record(record(doc.entities[id]?.components.camera)?.safeFrame);
  if (frame === null || !isVec3(frame.min) || !isVec3(frame.max)) return null;
  const corner = (field: "min" | "max", at: Vec3): ComponentHandle => ({
    id: `camera.safeFrame.${field}`,
    entity: id,
    component: "camera",
    field: `safeFrame.${field}`,
    at,
    axis: null,
    value: roundPoint,
  });
  return { handles: [corner("min", frame.min), corner("max", frame.max)], wires: boxWires(frame.min, frame.max) };
};

/** The frame of an entity in the world: a point of its frame in the world, and a world point in its frame. */
export interface EntityFrame {
  readonly origin: Vec3;
  toWorld(local: Vec3): Vec3;
  toLocal(world: Vec3): Vec3;
  /** A direction of its frame in the world (no scale). */
  direction(local: Vec3): Vec3;
}

/** The frame of an entity, or null when it has no place in the world. */
export function entityFrame(doc: SceneDocument, id: string): EntityFrame | null {
  const world = worldTransform(doc, id);
  if (world === undefined) return null;
  const { position, rotation, scale } = world;
  const safe = (value: number): number => (Math.abs(value) < 1e-9 ? 1 : value);
  return {
    origin: position,
    toWorld: (local) =>
      vadd(position, qrotate(rotation, [local[0] * scale[0], local[1] * scale[1], local[2] * scale[2]])),
    toLocal: (point) => {
      const turned = qrotate(qconjugate(rotation), vsub(point, position));
      return roundPoint([turned[0] / safe(scale[0]), turned[1] / safe(scale[1]), turned[2] / safe(scale[2])]);
    },
    direction: (local) => vnormalize(qrotate(rotation, local)),
  };
}

/** A circle of points in the world: a centre, two axes of its plane and a radius. */
export function circleWire(centre: Vec3, a: Vec3, b: Vec3, radius: number, steps = 32): HandleWire {
  const points = Array.from({ length: steps }, (_, at) => {
    const angle = (at / steps) * Math.PI * 2;
    return vadd(centre, vadd(vscale(a, Math.cos(angle) * radius), vscale(b, Math.sin(angle) * radius)));
  });
  return { points, closed: true };
}

/** The three circles of a sphere about the axes of the world. */
export function sphereWires(centre: Vec3, radius: number): HandleWire[] {
  return [
    circleWire(centre, [1, 0, 0], [0, 1, 0], radius),
    circleWire(centre, [1, 0, 0], [0, 0, 1], radius),
    circleWire(centre, [0, 1, 0], [0, 0, 1], radius),
  ];
}

/** The providers of the handles, in the order of their draw (handleProviders.ts puts more providers before them). */
export const HANDLE_PROVIDERS: HandleProvider[] = [targetHandles, shadowCameraHandles, safeFrameHandles];

/** The handles and the wires of an entity from each provider. */
export function entityHandles(
  doc: SceneDocument,
  id: string,
  providers: readonly HandleProvider[] = HANDLE_PROVIDERS,
): HandleSet {
  const sets = providers.map((provider) => provider(doc, id)).filter((set): set is HandleSet => set !== null);
  return { handles: sets.flatMap((set) => set.handles), wires: sets.flatMap((set) => set.wires) };
}

/** The point of a ray that is nearest to a line through `at` along `axis`. */
export function nearestOnAxis(
  ray: { readonly origin: Vec3; readonly direction: Vec3 },
  at: Vec3,
  axis: Vec3,
): Vec3 | null {
  const w0 = vsub(ray.origin, at);
  const a = vdot(ray.direction, ray.direction);
  const b = vdot(ray.direction, axis);
  const c = vdot(axis, axis);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) return null;
  const t = (a * vdot(axis, w0) - b * vdot(ray.direction, w0)) / denom;
  return vadd(at, vscale(axis, t));
}

/** The point of a ray on the plane through `at` that faces the view (`normal`: the direction of the view). */
export function onViewPlane(
  ray: { readonly origin: Vec3; readonly direction: Vec3 },
  at: Vec3,
  normal: Vec3,
): Vec3 | null {
  const facing = vdot(ray.direction, normal);
  if (Math.abs(facing) < 1e-9) return null;
  const t = vdot(vsub(at, ray.origin), normal) / facing;
  return t > 0 ? vadd(ray.origin, vscale(ray.direction, t)) : null;
}
