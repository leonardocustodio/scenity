// SPDX-License-Identifier: Apache-2.0
// The handles of the components in the Scene view: a point target and a ghost target of a light and a camera, the sides
// of the box of the shadow camera of a directional light, and the corners of a safe frame. Each place of a handle gives
// the new value of its field.
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import {
  boxWires,
  entityHandles,
  nearestOnAxis,
  onViewPlane,
  SHADOW_CAMERA_DEFAULTS,
} from "../../src/scene/handles/handleModel";

const DOC = {
  entities: {
    sun: {
      parent: null,
      components: {
        transform: { position: [0, 10, 0] },
        light: { type: "directional", shadow: true, target: [0, 0, 0], shadowCamera: { left: -8, right: 8, far: 40 } },
      },
    },
    spot: { parent: null, components: { transform: { position: [1, 2, 3] }, light: { type: "spot" } } },
    lamp: { parent: null, components: { transform: { position: [0, 1, 0] }, light: { type: "point" } } },
    front: {
      parent: null,
      components: {
        transform: { position: [0, 1, 5] },
        camera: { target: "entity:sun", safeFrame: { min: [-1, 0, -1], max: [1, 2, 1] } },
      },
    },
  },
} as unknown as SceneDocument;

const ids = (id: string) => entityHandles(DOC, id).handles.map((handle) => handle.id);

describe("the handles of the components", () => {
  it("give the targets: a point moves, an entity target has a wire only, no target has a ghost", () => {
    expect(ids("lamp")).toEqual([]);
    const spot = entityHandles(DOC, "spot").handles[0];
    expect(spot).toMatchObject({ id: "light.target", ghost: true, axis: null });
    // The ghost is 2 m in front of the spot (along -Z of the entity).
    expect(spot?.at).toEqual([1, 2, 1]);
    expect(spot?.value([1.23456, 2, 0.5])).toEqual([1.235, 2, 0.5]);
    const front = entityHandles(DOC, "front");
    expect(front.handles.map((handle) => handle.id)).toEqual(["camera.safeFrame.min", "camera.safeFrame.max"]);
    expect(front.wires[0]?.points).toEqual([
      [0, 1, 5],
      [0, 10, 0],
    ]);
    expect(boxWires([-1, 0, -1], [1, 2, 1])).toHaveLength(6);
  });

  it("give the sides of the shadow box of a light that looks straight down, with the defaults", () => {
    const set = entityHandles(DOC, "sun");
    const by = new Map(set.handles.map((handle) => [handle.id, handle]));
    expect([...by.keys()]).toEqual([
      "light.target",
      "light.shadowCamera.left",
      "light.shadowCamera.right",
      "light.shadowCamera.top",
      "light.shadowCamera.bottom",
      "light.shadowCamera.near",
      "light.shadowCamera.far",
    ]);
    const near = by.get("light.shadowCamera.near");
    expect(near?.at).toEqual([0, 10 - SHADOW_CAMERA_DEFAULTS.near, 0]);
    expect(near?.axis).toEqual([0, -1, 0]);
    // The far side moves along the direction of the light: 12 m below the light is a far plane of 12.
    expect(by.get("light.shadowCamera.far")?.value([0, -2, 0])).toBe(12);
    const right = by.get("light.shadowCamera.right");
    expect(right?.field).toBe("shadowCamera.right");
    expect(Math.abs(right?.value(right.at) as number)).toBe(8);
    expect(set.wires).toHaveLength(2 + 4 + 1);
  });

  it("find the point of a ray on the axis and on the plane of the view", () => {
    const ray = { origin: [0, 0, 10] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
    expect(nearestOnAxis(ray, [-5, 0, 0], [1, 0, 0])).toEqual([0, 0, 0]);
    expect(nearestOnAxis(ray, [0, 0, 0], [0, 0, 1])).toBeNull();
    expect(onViewPlane(ray, [3, 3, 2], [0, 0, -1])).toEqual([0, 0, 2]);
  });
});
