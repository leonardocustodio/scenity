// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of the places of an entity in the Scene view, each in the frame of the entity:
 *
 * - `socket`: a handle on each point; it moves in the plane of the view.
 * - `path`: a handle on each point (Alt and a press deletes it, while the path keeps two points), and a hollow handle
 *   in the middle of each segment that adds a point there.
 * - `obstacle`: the corners of a rectangle footprint (the opposite corner stays) and the points of a polygon footprint,
 *   on the ground of the entity.
 * - `standPoint`: the direction, a handle 1 m in front of the stand point that turns about the up axis.
 *
 * Pure functions, no DOM.
 */
import { vadd, vlerp, vscale, type Vec3 } from "@scenity/scene/math";
import {
  entityFrame,
  isVec3,
  record,
  round,
  type ComponentHandle,
  type EntityFrame,
  type HandleProvider,
  type HandleWire,
} from "./handleModel";

/** The handles of the socket points of an entity. */
export const socketHandles: HandleProvider = (doc, id) => {
  const points = record(record(doc.entities[id]?.components.socket)?.points);
  const frame = entityFrame(doc, id);
  if (points === null || frame === null) return null;
  const handles = Object.entries(points).flatMap(([name, point]): ComponentHandle[] => {
    const local = isVec3(point) ? point : record(point)?.position;
    if (!isVec3(local)) return [];
    // A point with a rotation keeps it: the handle moves its position only.
    const field = isVec3(point) ? `points.${name}` : `points.${name}.position`;
    return [
      {
        id: `socket.${field}`,
        entity: id,
        component: "socket",
        field,
        at: frame.toWorld(local),
        axis: null,
        value: (world) => frame.toLocal(world),
      },
    ];
  });
  return { handles, wires: [] };
};

/** The handles of the points of a path: move, add in the middle of a segment, and Alt to delete. */
export const pathHandles: HandleProvider = (doc, id) => {
  const path = record(doc.entities[id]?.components.path);
  const frame = entityFrame(doc, id);
  const points = Array.isArray(path?.points) ? (path.points as unknown[]).filter(isVec3) : [];
  if (path === null || frame === null || points.length < 2) return null;
  const base = { entity: id, component: "path", field: "points", axis: null };
  const moved = points.map((point, at): ComponentHandle => ({
    ...base,
    id: `path.points.${String(at)}`,
    at: frame.toWorld(point),
    value: (world) => points.map((item, index) => (index === at ? frame.toLocal(world) : item)),
    ...(points.length > 2 ? { remove: () => points.filter((_, index) => index !== at) } : {}),
  }));
  const closed = path.closed === true;
  const segments = closed ? points.length : points.length - 1;
  const added = Array.from({ length: segments }, (_, at): ComponentHandle => {
    const from = points[at] ?? [0, 0, 0];
    const to = points[(at + 1) % points.length] ?? from;
    return {
      ...base,
      id: `path.points.add.${String(at)}`,
      at: frame.toWorld(vlerp(from, to, 0.5)),
      ghost: true,
      value: (world) => [...points.slice(0, at + 1), frame.toLocal(world), ...points.slice(at + 1)],
    };
  });
  const line: HandleWire = { points: points.map((point) => frame.toWorld(point)), closed };
  return { handles: [...moved, ...added], wires: [line] };
};

/** A point of the ground of an entity as a world point: (x, z) of the footprint at the height 0 of its frame. */
const ground = (frame: EntityFrame, point: readonly number[]): Vec3 => frame.toWorld([point[0] ?? 0, 0, point[1] ?? 0]);
/** A world point on the ground of an entity as (x, z) of its frame. */
const flat = (frame: EntityFrame, world: Vec3): [number, number] => {
  const local = frame.toLocal(world);
  return [local[0], local[2]];
};

/** The handles of the footprint of an obstacle: the corners of a rectangle, or the points of a polygon. */
export const footprintHandles: HandleProvider = (doc, id) => {
  const footprint = record(record(doc.entities[id]?.components.obstacle)?.footprint);
  const frame = entityFrame(doc, id);
  if (footprint === null || frame === null) return null;
  const base = { entity: id, component: "obstacle", axis: null, plane: frame.direction([0, 1, 0]) };
  if (footprint.kind === "polygon" && Array.isArray(footprint.points)) {
    const points = footprint.points as readonly (readonly number[])[];
    const handles = points.map((point, at): ComponentHandle => ({
      ...base,
      id: `obstacle.footprint.points.${String(at)}`,
      field: `footprint.points.${String(at)}`,
      at: ground(frame, point),
      value: (world) => flat(frame, world),
    }));
    return { handles, wires: [{ points: points.map((point) => ground(frame, point)), closed: true }] };
  }
  if (footprint.kind !== "rect" || !Array.isArray(footprint.size)) return null;
  const [cx = 0, cz = 0] = Array.isArray(footprint.centre) ? (footprint.centre as number[]) : [];
  const [w = 1, d = 1] = footprint.size as number[];
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const place = ([sx, sz]: [number, number]): [number, number] => [cx + (sx * w) / 2, cz + (sz * d) / 2];
  const handles = corners.map(([sx, sz], at): ComponentHandle => {
    const opposite = place([-sx, -sz] as [number, number]);
    return {
      ...base,
      id: `obstacle.footprint.corner.${String(at)}`,
      field: "footprint",
      at: ground(frame, place([sx, sz])),
      value: (world) => {
        const [x, z] = flat(frame, world);
        const centre = [round((x + opposite[0]) / 2), round((z + opposite[1]) / 2)];
        return { kind: "rect", centre, size: [round(Math.abs(x - opposite[0])), round(Math.abs(z - opposite[1]))] };
      },
    };
  });
  return { handles, wires: [{ points: corners.map((corner) => ground(frame, place(corner))), closed: true }] };
};

/** The handle of the direction of a stand point: 1 m in front of it, on its ground; the yaw 0 faces -Z of the frame. */
export const standPointHandles: HandleProvider = (doc, id) => {
  const stand = record(doc.entities[id]?.components.standPoint);
  const frame = entityFrame(doc, id);
  if (stand === null || frame === null) return null;
  const facing = typeof stand.facing === "number" ? stand.facing : 0;
  const ahead: Vec3 = [-Math.sin(facing), 0, -Math.cos(facing)];
  const tip = frame.toWorld(ahead);
  return {
    handles: [
      {
        id: "standPoint.facing",
        entity: id,
        component: "standPoint",
        field: "facing",
        at: tip,
        axis: null,
        plane: frame.direction([0, 1, 0]),
        value: (world) => {
          const local = frame.toLocal(world);
          return round(Math.atan2(-local[0], -local[2]));
        },
      },
    ],
    wires: [{ points: [frame.origin, tip, vadd(tip, vscale(frame.direction([0, 1, 0]), 0.1))] }],
  };
};
