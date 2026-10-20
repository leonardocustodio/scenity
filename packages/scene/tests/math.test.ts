// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  composeMatrix,
  eulerFromQuat,
  multiplyMatrices,
  qfromAxisAngle,
  qmul,
  qrotate,
  quatFromEuler,
  socketWorld,
  transformPoint,
  vcross,
  vnormalize,
  worldTransform,
  type Vec3,
} from "../src/index";
import { fixture } from "./helpers";

const close = (actual: readonly number[], expected: readonly number[], digits = 6) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
};

describe("vectors and quaternions", () => {
  test("cross and normalize", () => {
    expect(vcross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(vnormalize([3, 0, 4])).toEqual([0.6, 0, 0.8]);
    expect(vnormalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test("a quarter turn about Y takes +X to -Z", () => {
    close(qrotate(qfromAxisAngle([0, 1, 0], Math.PI / 2), [1, 0, 0]), [0, 0, -1]);
  });

  test("qmul applies the right rotation first", () => {
    const yaw = qfromAxisAngle([0, 1, 0], Math.PI / 2);
    const pitch = qfromAxisAngle([1, 0, 0], Math.PI / 2);
    close(qrotate(qmul(yaw, pitch), [0, 1, 0]), qrotate(yaw, qrotate(pitch, [0, 1, 0])));
  });
});

describe("Euler angles for the editor (degrees, XYZ)", () => {
  test("known values match three.js", () => {
    close(quatFromEuler([90, 0, 0]), [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    close(quatFromEuler([0, 0, 180]), [0, 0, 1, 0]);
    // The order XYZ of three.js is the product Rx × Ry × Rz.
    const [x, y, z] = [0.1, 0.2, 0.3];
    const product = qmul(
      qmul(qfromAxisAngle([1, 0, 0], x), qfromAxisAngle([0, 1, 0], y)),
      qfromAxisAngle([0, 0, 1], z),
    );
    close(quatFromEuler([(x * 180) / Math.PI, (y * 180) / Math.PI, (z * 180) / Math.PI]), product, 12);
    close(product, [0.0640713, 0.0911575, 0.1534393, 0.9818562]);
  });

  test("Euler to quaternion and back gives the same angles", () => {
    const cases: Vec3[] = [
      [10, 20, 30],
      [-45, 80, 170],
      [0, -89, 0],
      [120, 0, -60],
    ];
    for (const euler of cases) close(eulerFromQuat(quatFromEuler(euler)), euler, 4);
  });

  test("the gimbal case gives a rotation with the same effect", () => {
    const q = quatFromEuler([30, 90, 0]);
    const again = quatFromEuler(eulerFromQuat(q));
    close(qrotate(again, [1, 2, 3]), qrotate(q, [1, 2, 3]), 5);
  });
});

describe("matrices", () => {
  test("compose matches Matrix4.compose of three.js (column-major)", () => {
    const m = composeMatrix([1, 2, 3], qfromAxisAngle([0, 0, 1], Math.PI / 2), [2, 2, 2]);
    close(m, [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1]);
    close(transformPoint(m, [1, 0, 0]), [1, 4, 3]);
  });

  test("the product applies the right matrix first", () => {
    const move = composeMatrix([5, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    const turn = composeMatrix([0, 0, 0], qfromAxisAngle([0, 1, 0], Math.PI), [1, 1, 1]);
    close(transformPoint(multiplyMatrices(move, turn), [1, 0, 0]), [4, 0, 0]);
  });
});

describe("world transforms and sockets", () => {
  const scene = fixture("main.scene.json", "scene");

  test("a child gets the transform of its parent", () => {
    const cart = worldTransform(scene, "cart")!;
    const lamp = worldTransform(scene, "lamp")!;
    close(cart.position, [0.85, 0, -1.45]);
    // The lamp is 0.92 m above the cart origin. The cart turns about Y only.
    close(lamp.position, [0.85, 0.92, -1.45]);
    close(lamp.rotation, cart.rotation);
    close(transformPoint(lamp.matrix, [0, 0, 0]), lamp.position);
    expect(worldTransform(scene, "ghost")).toBeUndefined();
  });

  test("a socket world point goes through the hierarchy", () => {
    const workshop = fixture("workshop.scene.json", "scene");
    const port = socketWorld(workshop, "entity:drill#port")!;
    const cart = worldTransform(workshop, "cart")!;
    const local: Vec3 = [-0.12, 0.92 + 0.05, 0.05 + 0.1];
    close(port.position, transformPoint(cart.matrix, local));
    const foot = socketWorld(workshop, "entity:bench#foot")!;
    close(
      qrotate(foot.rotation, [0, 0, 1]),
      qrotate(qmul(quatFromEuler([0, 90, 0]), quatFromEuler([0, 180, 0])), [0, 0, 1]),
      5,
    );
    expect(socketWorld(workshop, "entity:drill#nope")).toBeUndefined();
    expect(socketWorld(workshop, "entity:drill")).toBeUndefined();
    expect(socketWorld(workshop, "asset:x")).toBeUndefined();
  });

  test("scale of the parent scales the child position", () => {
    const doc = {
      entities: {
        a: { parent: null, index: 0, components: { transform: { position: [1, 0, 0], scale: [2, 2, 2] } } },
        b: { parent: "a", index: 0, components: { transform: { position: [1, 0, 0] } } },
      },
    };
    close(worldTransform(doc, "b")!.position, [3, 0, 0]);
    close(worldTransform(doc, "b")!.scale, [2, 2, 2]);
  });
});
