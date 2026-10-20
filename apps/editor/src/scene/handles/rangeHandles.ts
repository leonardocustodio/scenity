// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of the ranges and the cones in the Scene view: the range of a point light (a
 * sphere), the range and the cone of a spot light, the frustum and the field of view of a camera, and the reference
 * and the largest distances of an audio source. A range of 0 (no limit) has a hollow handle 5 m out that sets a range.
 * Pure functions, no DOM.
 */
import { vadd, vdot, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  aimFrame,
  circleWire,
  entityFrame,
  record,
  round,
  sphereWires,
  type ComponentHandle,
  type HandleProvider,
  type HandleWire,
} from "./handleModel";

/** The place of the handle of a range with no limit (metres). */
const NO_LIMIT_AT = 5;
/** The depth of the frustum of a camera in the view (metres) and the aspect of its frame. */
const FRUSTUM_DEPTH = 1.5;
const FRUSTUM_ASPECT = 16 / 9;
/** The default cone of a spot light (radians) and field of view of a camera (degrees), as the components. */
const SPOT_ANGLE = 0.785398;
const CAMERA_FOV = 50;
/** The largest distance of an audio source that shows: a larger one is no limit for the view. */
const AUDIO_MAX_SHOWN = 200;

const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** A handle of a distance from `origin` along `axis`: the value is the distance of the place along the axis. */
function distanceHandle(
  base: Pick<ComponentHandle, "entity" | "component">,
  field: string,
  origin: Vec3,
  axis: Vec3,
  distance: number | null,
  least = 0,
): ComponentHandle {
  const shown = distance ?? NO_LIMIT_AT;
  return {
    ...base,
    id: `${base.component}.${field}`,
    field,
    at: vadd(origin, vscale(axis, shown)),
    axis,
    ...(distance === null ? { ghost: true } : {}),
    value: (world) => round(Math.max(least, vdot(vsub(world, origin), axis))),
  };
}

/** The handles of the range of a point light, and of the range and the cone of a spot light. */
export const lightRangeHandles: HandleProvider = (doc, id) => {
  const light = record(doc.entities[id]?.components.light);
  if (light === null || (light.type !== "point" && light.type !== "spot")) return null;
  const range = number(light.range, 0);
  const base = { entity: id, component: "light" };
  if (light.type === "point") {
    const frame = entityFrame(doc, id);
    if (frame === null) return null;
    return {
      handles: [distanceHandle(base, "range", frame.origin, [1, 0, 0], range > 0 ? range : null)],
      wires: range > 0 ? sphereWires(frame.origin, range) : [],
    };
  }
  const aim = aimFrame(doc, id, light.target);
  if (aim === null) return null;
  const length = range > 0 ? range : NO_LIMIT_AT;
  const angle = number(light.angle, SPOT_ANGLE);
  const centre = vadd(aim.origin, vscale(aim.forward, length));
  const radius = length * Math.tan(angle);
  const rim = circleWire(centre, aim.right, aim.up, radius);
  const edges: HandleWire[] = [aim.up, aim.right, vscale(aim.up, -1), vscale(aim.right, -1)].map((side) => ({
    points: [aim.origin, vadd(centre, vscale(side, radius))],
  }));
  const cone: ComponentHandle = {
    ...base,
    id: "light.angle",
    field: "angle",
    at: vadd(centre, vscale(aim.up, radius)),
    axis: aim.up,
    value: (world) =>
      round(Math.min(Math.PI / 2, Math.max(0.01, Math.atan2(vdot(vsub(world, centre), aim.up), length)))),
  };
  return {
    handles: [distanceHandle(base, "range", aim.origin, aim.forward, range > 0 ? range : null), cone],
    wires: [rim, ...edges],
  };
};

/** The handles of the frustum of a camera: the field of view at the top edge of its frame. */
export const cameraFrustumHandles: HandleProvider = (doc, id) => {
  const camera = record(doc.entities[id]?.components.camera);
  const aim = camera === null ? null : aimFrame(doc, id, camera.target);
  if (camera === null || aim === null) return null;
  const fov = number(camera.fov, CAMERA_FOV);
  const half = FRUSTUM_DEPTH * Math.tan((fov * Math.PI) / 360);
  const wide = half * FRUSTUM_ASPECT;
  const centre = vadd(aim.origin, vscale(aim.forward, FRUSTUM_DEPTH));
  const corner = (x: number, y: number): Vec3 =>
    vadd(centre, vadd(vscale(aim.right, x * wide), vscale(aim.up, y * half)));
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  return {
    handles: [
      {
        id: "camera.fov",
        entity: id,
        component: "camera",
        field: "fov",
        at: vadd(centre, vscale(aim.up, half)),
        axis: aim.up,
        value: (world) => {
          const height = Math.max(0.001, vdot(vsub(world, centre), aim.up));
          return Math.round(Math.min(179, Math.max(1, (Math.atan2(height, FRUSTUM_DEPTH) * 360) / Math.PI)) * 10) / 10;
        },
      },
    ],
    wires: [{ points: corners, closed: true }, ...corners.map((point) => ({ points: [aim.origin, point] }))],
  };
};

/** The handles of the reference distance and of the largest distance of a spatial audio source. */
export const audioRangeHandles: HandleProvider = (doc: SceneDocument, id: string) => {
  const audio = record(doc.entities[id]?.components.audioSource);
  const frame = entityFrame(doc, id);
  if (audio === null || frame === null || audio.spatial === false) return null;
  const base = { entity: id, component: "audioSource" };
  const reference = number(audio.refDistance, 1);
  const largest = number(audio.maxDistance, Infinity);
  // The two distances must be above 0.
  const handles = [distanceHandle(base, "refDistance", frame.origin, [1, 0, 0], reference, 0.01)];
  const wires = sphereWires(frame.origin, reference);
  if (largest <= AUDIO_MAX_SHOWN) {
    handles.push(distanceHandle(base, "maxDistance", frame.origin, [0, 0, 1], largest, 0.01));
    wires.push(circleWire(frame.origin, [1, 0, 0], [0, 0, 1], largest, 64));
  }
  return { handles, wires };
};
