// SPDX-License-Identifier: Apache-2.0 The math of the editor camera: the view of an orbit camera, the turn about the
// target, the turn in place, the pan, the dolly, the fly and the frame of a box (the F key of the viewport).
import { describe, expect, it } from "bun:test";
import { vadd, vdot, vlength, vnormalize, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import {
  dolly,
  fly,
  forwardOf,
  frameBox,
  look,
  MAX_PITCH,
  orbit,
  orbitFromView,
  pan,
  pixelSize,
  unionBox,
  viewAxes,
  viewOf,
  type OrbitCamera,
} from "../src/index";

const CAMERA: OrbitCamera = { target: [0, 0.5, 0], yaw: 0.4, pitch: -0.3, distance: 6, fov: 50 };

function close(a: readonly number[], b: readonly number[], digits = 6): void {
  a.forEach((value, index) => expect(value).toBeCloseTo(b[index] ?? NaN, digits));
}

/** The canvas point of a world point (the projection of dragMath.ts of the scene page). */
function project(camera: OrbitCamera, point: Vec3, width: number, height: number) {
  const view = viewOf(camera);
  const forward = vnormalize(vsub(view.target, view.position));
  const { right, up } = viewAxes(forward);
  const tan = Math.tan((view.fov * Math.PI) / 360);
  const offset = vsub(point, view.position);
  const depth = vdot(offset, forward);
  const x = vdot(offset, right) / (depth * tan * (width / height));
  const y = vdot(offset, up) / (depth * tan);
  return { x: ((x + 1) / 2) * width, y: ((1 - y) / 2) * height, depth };
}

describe("the editor camera", () => {
  it("gives back the view that it was made from", () => {
    const view = { position: [3, 2, 5] as Vec3, target: [0, 0.5, 0] as Vec3, fov: 42 };
    const camera = orbitFromView(view);
    const again = viewOf(camera);
    close(again.position, view.position);
    close(again.target, view.target);
    expect(again.fov).toBe(42);
    // A yaw of 0 looks along -Z, as the cameras of three.js do.
    close(forwardOf(0, 0), [0, 0, -1]);
  });

  it("turns about the target and keeps the distance; the tilt stops before the vertical", () => {
    const turned = orbit(CAMERA, 0.5, 0.2);
    close(turned.target, CAMERA.target);
    expect(vlength(vsub(viewOf(turned).position, turned.target))).toBeCloseTo(6, 9);
    expect(orbit(CAMERA, 0, 10).pitch).toBe(MAX_PITCH);
    expect(orbit(CAMERA, 0, -10).pitch).toBe(-MAX_PITCH);
  });

  it("turns in place: the place stays and the target moves", () => {
    const turned = look(CAMERA, 0.3, 0.1);
    close(viewOf(turned).position, viewOf(CAMERA).position);
    expect(turned.target).not.toEqual(CAMERA.target);
  });

  it("pans so that a point at the target stays under the pointer", () => {
    const [width, height] = [800, 600];
    const before = project(CAMERA, CAMERA.target, width, height);
    const moved = pan(CAMERA, 40, -25, height);
    const after = project(moved, CAMERA.target, width, height);
    expect(after.x - before.x).toBeCloseTo(40, 6);
    expect(after.y - before.y).toBeCloseTo(-25, 6);
    expect(moved.distance).toBe(CAMERA.distance);
    expect(pixelSize(CAMERA, height)).toBeCloseTo((2 * 6 * Math.tan((25 * Math.PI) / 180)) / 600, 9);
  });

  it("moves nearer and farther within its limits", () => {
    expect(dolly(CAMERA, 0.5).distance).toBe(3);
    expect(dolly(CAMERA, 1e-9).distance).toBe(0.05);
    expect(dolly(CAMERA, 1e9).distance).toBe(10_000);
  });

  it("flies the place and the target together", () => {
    const flown = fly(CAMERA, 1, 2, 0.5);
    const forward = forwardOf(CAMERA.yaw, CAMERA.pitch);
    const { right } = viewAxes(forward);
    const move = vadd(vadd(vscale(right, 1), vscale(forward, 2)), [0, 0.5, 0]);
    close(flown.target, vadd(CAMERA.target, move));
    close(viewOf(flown).position, vadd(viewOf(CAMERA).position, move));
  });

  it("frames a box: the target is its centre and the box fills the view", () => {
    const box = { min: [1, 0, -2] as Vec3, max: [2, 0.8, -1.2] as Vec3 };
    for (const aspect of [16 / 9, 1, 0.5]) {
      const framed = frameBox(CAMERA, box, aspect);
      close(framed.target, [1.5, 0.4, -1.6]);
      expect(framed.yaw).toBe(CAMERA.yaw);
      expect(framed.pitch).toBe(CAMERA.pitch);
      const [width, height] = [Math.round(600 * aspect), 600];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const x of [box.min[0], box.max[0]])
        for (const y of [box.min[1], box.max[1]])
          for (const z of [box.min[2], box.max[2]]) {
            const point = project(framed, [x, y, z], width, height);
            expect(point.depth).toBeGreaterThan(0);
            xs.push(point.x);
            ys.push(point.y);
          }
      // Each corner is on the canvas, and the box covers a large part of the narrower side.
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(width);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(height);
      const share = Math.max((Math.max(...xs) - Math.min(...xs)) / width, (Math.max(...ys) - Math.min(...ys)) / height);
      expect(share).toBeGreaterThan(0.35);
    }
  });

  it("frames a point with the nearest distance, and the union of boxes", () => {
    const point = frameBox(CAMERA, { min: [1, 1, 1], max: [1, 1, 1] }, 1);
    close(point.target, [1, 1, 1]);
    expect(point.distance).toBeGreaterThan(0.05);
    expect(unionBox([])).toBeNull();
    expect(
      unionBox([
        { min: [0, 0, 0], max: [1, 1, 1] },
        { min: [-1, 0.5, 2], max: [0, 2, 3] },
      ]),
    ).toEqual({ min: [-1, 0, 0], max: [1, 2, 3] });
  });
});
