// SPDX-License-Identifier: Apache-2.0
// The glTF export of the showroom in the pinned Blender: Blender imports the GLB file
// (blender/gltf_world.py), and the world place of each entity object is the place of the document. glTF is Y up and
// Blender is Z up: the importer turns a point (x, y, z) into (x, -z, y). The test runs where Blender 5.2 is on this
// machine (BLENDER, or the Blender app of macOS), as `py:test`.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { qrotate, worldTransform, type Quat, type SceneDocument, type Vec3 } from "@scenity/scene";
import { blenderScript, hasLocalBlender, runBlender } from "../src/blender/run";
import { exportScene } from "../src/export/project";
import { direction, dot, TOLERANCE } from "./exportHelpers";
import { put, removeTemps, SHOWROOM, tempDir } from "./helpers";

const BLENDER = hasLocalBlender();
if (!BLENDER) {
  console.warn(
    "skip: the Blender check of the glTF export needs Blender 5.2 on this machine: set BLENDER to its path, " +
      "or install /Applications/Blender.app on macOS",
  );
}
afterAll(removeTemps);

interface BlenderObject {
  readonly name: string;
  readonly type: string;
  readonly parent: string;
  readonly entity: string;
  readonly location: Vec3;
  /** The world rotation as Blender gives it: w, x, y, z. */
  readonly rotation: readonly [number, number, number, number];
}

/** A point of glTF (Y up) in the frame of Blender (Z up). */
function toBlender([x, y, z]: readonly number[]): Vec3 {
  return [x!, -z!, y!];
}

/** A rotation of glTF (`[x, y, z, w]`, Y up) as a Blender quaternion (`[w, x, y, z]`, Z up). */
function rotationToBlender([x, y, z, w]: Quat): [number, number, number, number] {
  return [w, x, -z, y];
}

/** The export of the showroom and the report of Blender, made one time for the tests. */
let run: Promise<{ scene: SceneDocument; objects: BlenderObject[] }> | undefined;

function blenderRun(): Promise<{ scene: SceneDocument; objects: BlenderObject[] }> {
  run ??= (async () => {
    const dir = tempDir();
    const exported = await exportScene(SHOWROOM, "main", { runImports: false });
    put(dir, "showroom.glb", exported.glb);
    const report = join(dir, "world.json");
    const args = ["--python", blenderScript("gltf_world.py"), "--", "--in", join(dir, "showroom.glb"), "--out", report];
    runBlender(args, [dir]);
    const objects = (JSON.parse(readFileSync(report, "utf8")) as { objects: BlenderObject[] }).objects;
    return { scene: exported.scene, objects };
  })();
  return run;
}

describe.skipIf(!BLENDER)("the glTF export in Blender", () => {
  test("each entity object has the world place of the document", async () => {
    const { scene, objects } = await blenderRun();
    for (const [id, entity] of Object.entries(scene.entities)) {
      const object = objects.find((item) => item.name === id);
      expect(object).toMatchObject({ entity: id, parent: entity.parent ?? "" });
      const world = worldTransform(scene, id)!;
      const expected = toBlender(world.position);
      const worst = Math.max(...expected.map((part, axis) => Math.abs(part - object!.location[axis]!)));
      expect({ id, worst: worst <= TOLERANCE ? 0 : worst }).toEqual({ id, worst: 0 });
      // q and -q are the same rotation.
      const turn = Math.abs(dot4(rotationToBlender(world.rotation), object!.rotation));
      expect({ id, turn: turn >= 1 - TOLERANCE }).toEqual({ id, turn: true });
    }
  }, 120_000);

  test("each camera of Blender looks at the target of the document", async () => {
    const { scene, objects } = await blenderRun();
    for (const id of ["front", "top"]) {
      const camera = objects.find((item) => item.name === `${id}:camera`)!;
      expect(camera.type).toBe("CAMERA");
      const [w, x, y, z] = camera.rotation;
      // A Blender camera looks along its local -Z.
      const forward = qrotate([x, y, z, w], [0, 0, -1]);
      const target = (scene.entities[id]!.components.camera as { target: Vec3 }).target;
      expect(dot(forward, direction(camera.location, toBlender(target)))).toBeGreaterThan(1 - 1e-4);
    }
  }, 120_000);
});

function dot4(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}
