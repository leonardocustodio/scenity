// SPDX-License-Identifier: Apache-2.0
// The snap of a free move to surfaces and sockets: the rules of the lab snap with the surfaces from entity bounds.
// The boxes are a floor, a table top and a thin wall. The sockets come from the garden.
import { describe, expect, it } from "bun:test";
import { vnormalize, vsub, type Vec3 } from "@scenity/scene/math";
import {
  freeMove,
  onSurface,
  restHeight,
  socketMove,
  socketPoints,
  surfaceMove,
  surfacesOf,
  type BoxedEntity,
  type FreeStart,
} from "../src/index";
import { garden } from "./helpers";

const BOXES: BoxedEntity[] = [
  { id: "floor", box: { min: [-5, 0, -5], max: [5, 0, 5] } },
  { id: "table", box: { min: [-0.6, 0, -0.4], max: [0.6, 0.75, 0.4] } },
  { id: "wall", box: { min: [-5, 0, -3], max: [5, 3, -3] } },
  { id: "light", box: null },
  { id: "crate", box: { min: [2.8, 0, -0.2], max: [3.2, 0.4, 0.2] } },
];

const CAMERA: Vec3 = [0, 4, 4];

/** The ray from the camera through a world point. */
function rayTo(point: Vec3): { origin: Vec3; direction: Vec3 } {
  return { origin: CAMERA, direction: vnormalize(vsub(point, CAMERA)) };
}

describe("the surfaces of entity bounds", () => {
  it("are the tops of the boxes, without the moved entities and the thin boxes", () => {
    const surfaces = surfacesOf(BOXES, new Set(["crate"]));
    expect(surfaces.map((surface) => surface.id)).toEqual(["floor", "table"]);
    const table = surfaces[1];
    if (table === undefined) throw new Error("no table");
    expect(table.y).toBe(0.75);
    expect(onSurface(table, [0.5, 0, 0.3])).toBe(true);
    expect(onSurface(table, [0.7, 0, 0])).toBe(false);
    expect(restHeight(table, 0.76)).toBe(0.76);
    expect(restHeight(table, 0.7)).toBe(0.75);
  });

  it("put a resting entity on the surface under the pointer, with the grab point under the pointer", () => {
    const surfaces = surfacesOf(BOXES, new Set(["crate"]));
    // The crate stands on the floor; its origin is at its base; the press was on its top.
    const start: FreeStart = { origin: [3, 0, 0], base: 0, grab: [3, 0.4, 0] };
    // The pointer is over the table top: the grabbed point is 0.4 m over the top.
    const onTable = surfaceMove(start, rayTo([0.2, 1.15, 0.1]), surfaces, 0.01);
    expect(onTable?.surface.id).toBe("table");
    expect(onTable?.origin).toEqual([0.2, 0.75, 0.1]);
    // The pointer is over the floor beside the table.
    const onFloor = surfaceMove(start, rayTo([1.5, 0.4, 1]), surfaces, 0.01);
    expect(onFloor?.surface.id).toBe("floor");
    expect(onFloor?.origin).toEqual([1.5, 0, 1]);
  });

  it("keep an entity in the air off the ground, but a raised surface takes it", () => {
    const surfaces = surfacesOf(BOXES, new Set(["crate"]));
    const start: FreeStart = { origin: [3, 1.5, 0], base: 1.5, grab: [3, 1.9, 0] };
    expect(surfaceMove(start, rayTo([1.5, 1.9, 1]), surfaces, 0.01)).toBeNull();
    expect(surfaceMove(start, rayTo([0, 1.15, 0]), surfaces, 0.01)?.surface.id).toBe("table");
    // With no surface the move stays on the level plane of the grab point.
    const level = freeMove(start, rayTo([2, 1.9, 1]), {
      grid: 0.1,
      surface: true,
      surfaces,
      sockets: [],
      own: [],
    });
    expect(level).toEqual({ origin: [2, 1.5, 1], surface: null, socket: null });
  });
});

describe("the socket snap", () => {
  it("reads the world sockets of the document", () => {
    const sockets = socketPoints(garden());
    expect(sockets.map((socket) => socket.ref)).toEqual([
      "entity:bench#left",
      "entity:bench#right",
      "entity:table#top",
    ]);
    expect(sockets[0]?.at).toEqual([0.9, 0.45, -1]);
    expect(socketPoints(garden(), new Set(["table"])).map((socket) => socket.owner)).toEqual(["table"]);
  });

  it("moves the origin or the nearest own socket onto a socket within 8 cm", () => {
    const targets = socketPoints(garden(), new Set(["table"]));
    expect(socketMove([0.05, 0.75, 0.03], [], targets)?.origin).toEqual([0, 0.75, 0]);
    expect(socketMove([0.1, 0.75, 0], [], targets)).toBeNull();
    // An own socket 0.2 m over the origin meets the table top.
    expect(socketMove([0.02, 0.57, 0], [[0, 0.2, 0]], targets)?.origin).toEqual([0, 0.55, 0]);
    // The free move: the surface first, then the socket; Alt (no surface snap) gives the level plane only.
    const surfaces = surfacesOf(BOXES, new Set(["crate"]));
    const start: FreeStart = { origin: [3, 0, 0], base: 0, grab: [3, 0.4, 0] };
    const snap = { grid: 0.01, surface: true, surfaces, sockets: targets, own: [] };
    const near = freeMove(start, rayTo([0.04, 1.15, 0.03]), snap);
    expect(near?.socket?.ref).toBe("entity:table#top");
    expect(near?.origin).toEqual([0, 0.75, 0]);
    const free = freeMove(start, rayTo([0.04, 1.15, 0.03]), { ...snap, surface: false });
    expect(free?.socket).toBeNull();
    expect(free?.origin[1]).toBe(0);
  });
});
