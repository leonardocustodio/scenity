// SPDX-License-Identifier: Apache-2.0
// The handles of the Scene view: the range and the cone of the lights, the field of view of a camera, and the distances
// of an audio source. Also the socket points, the points of a path (move, add, delete), the footprint of an obstacle
// and the facing of a stand point. Each place of a handle gives the new value of its field.
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import { entityHandles, type ComponentHandle } from "../../src/scene/handles/handleModel";
import { ALL_HANDLE_PROVIDERS } from "../../src/scene/handles/handleProviders";

const DOC = {
  entities: {
    bulb: { parent: null, components: { transform: { position: [0, 2, 0] }, light: { type: "point", range: 3 } } },
    spot: {
      parent: null,
      components: { transform: { position: [0, 4, 0] }, light: { type: "spot", target: [0, 0, 0] } },
    },
    eye: { parent: null, components: { transform: { position: [0, 1, 5] }, camera: { fov: 40 } } },
    radio: { parent: null, components: { transform: { position: [2, 0, 0] }, audioSource: { maxDistance: 8 } } },
    shelf: {
      parent: null,
      components: {
        transform: { position: [1, 0, 0], scale: [2, 2, 2] },
        socket: { points: { top: [0, 1, 0], side: { position: [0.5, 0, 0], rotation: [0, 0, 0, 1] } } },
      },
    },
    route: {
      parent: null,
      components: {
        transform: { position: [0, 0, 0] },
        path: {
          points: [
            [0, 0, 0],
            [2, 0, 0],
            [2, 0, 2],
          ],
        },
      },
    },
    rock: {
      parent: null,
      components: {
        transform: { position: [10, 0, 0] },
        obstacle: { footprint: { kind: "rect", centre: [0, 0], size: [2, 1] } },
      },
    },
    spot2: { parent: null, components: { transform: { position: [0, 0, 3] }, standPoint: { facing: 0 } } },
  },
} as unknown as SceneDocument;

const handles = (id: string): Map<string, ComponentHandle> =>
  new Map(entityHandles(DOC, id, ALL_HANDLE_PROVIDERS).handles.map((handle) => [handle.id, handle]));

describe("the handles of the Scene view", () => {
  it("give the ranges, the cone, the field of view and the audio distances", () => {
    const bulb = handles("bulb").get("light.range");
    expect(bulb?.at).toEqual([3, 2, 0]);
    expect(bulb?.value([4.5, 2, 0])).toBe(4.5);
    const spot = handles("spot");
    // A range of 0 has a hollow handle 5 m along the cone; the cone handle gives the half angle.
    expect(spot.get("light.range")).toMatchObject({ ghost: true, at: [0, -1, 0] });
    const cone = spot.get("light.angle");
    expect(cone?.value(cone.at)).toBeCloseTo(0.785, 3);
    const fov = handles("eye").get("camera.fov");
    expect(fov?.value(fov.at)).toBe(40);
    const radio = handles("radio");
    expect([...radio.keys()]).toEqual(["audioSource.refDistance", "audioSource.maxDistance"]);
    expect(radio.get("audioSource.refDistance")?.value([2, 0, 0])).toBe(0.01);
  });

  it("give the sockets and the path points in the frame of the entity", () => {
    const shelf = handles("shelf");
    expect(shelf.get("socket.points.top")?.at).toEqual([1, 2, 0]);
    expect(shelf.get("socket.points.top")?.value([1, 4, 0])).toEqual([0, 2, 0]);
    expect(shelf.get("socket.points.side.position")?.field).toBe("points.side.position");
    const route = handles("route");
    expect(route.get("path.points.1")?.value([3, 0, 0])).toEqual([
      [0, 0, 0],
      [3, 0, 0],
      [2, 0, 2],
    ]);
    expect(route.get("path.points.1")?.remove?.()).toEqual([
      [0, 0, 0],
      [2, 0, 2],
    ]);
    expect(route.get("path.points.add.0")).toMatchObject({ ghost: true, at: [1, 0, 0] });
    expect(route.get("path.points.add.0")?.value([1, 0, -1])).toHaveLength(4);
  });

  it("give the footprint corners and the facing on the ground", () => {
    const corner = handles("rock").get("obstacle.footprint.corner.2");
    expect(corner?.at).toEqual([11, 0, 0.5]);
    expect(corner?.plane).toEqual([0, 1, 0]);
    // The opposite corner (-1, -0.5) stays.
    expect(corner?.value([12, 0, 1.5])).toEqual({ kind: "rect", centre: [0.5, 0.5], size: [3, 2] });
    const facing = handles("spot2").get("standPoint.facing");
    expect(facing?.at).toEqual([0, 0, 2]);
    expect(facing?.value([1, 0, 3])).toBeCloseTo(-Math.PI / 2, 3);
  });
});
