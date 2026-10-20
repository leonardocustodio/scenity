// SPDX-License-Identifier: Apache-2.0
// Lights and cameras as entities: the lights of a document with their
// targets, the limits of a quality tier, the shadow camera that fits the shadow casters, the safe frame of a camera
// and the clip planes from the bounds of the scene. Three.js runs with no renderer.
import { describe, expect, it } from "bun:test";
import {
  type AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  type PointLight,
  type SpotLight,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import { readDocument, type SceneDocument } from "@scenity/scene";
import type { CameraValue } from "@scenity/scene/components";
import { TIERS } from "../src/core/tiers";
import { SceneBuilder } from "../src/scene/builder";
import { clipPlanes, frameDocumentCamera, safeBoxes } from "../src/scene/cameraFrame";
import { frameLighting } from "../src/scene/lighting";
import { FakeAssets, showroom } from "./sceneHelpers";

type Entities = Record<string, { parent?: string | null; index?: number; components: Record<string, unknown> }>;

/** A scene document of entities at the root, read and checked by the reader of `@scenity/scene`. */
function sceneOf(entities: Entities): SceneDocument {
  const full = Object.fromEntries(
    Object.entries(entities).map(([id, entity], index) => [id, { parent: null, index, ...entity }]),
  );
  const result = readDocument(JSON.stringify({ format: "scenity.scene/1", id: "test", entities: full }), "scene");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

function build(doc: SceneDocument): SceneBuilder {
  const builder = new SceneBuilder({ assets: new FakeAssets() });
  builder.build(doc);
  return builder;
}

function lightOf<T extends Object3D>(builder: SceneBuilder, id: string): T {
  return builder.componentObject(id, "light") as T;
}

/** A floor of 10 m, a box of 1 m on it, and a directional light from above at the side with the box as its target. */
const STAGE: Entities = {
  floor: { components: { shape: { kind: "plane", size: [10, 0, 10], castShadow: false } } },
  box: { components: { transform: { position: [1, 0.5, 0] }, shape: { kind: "box", size: [1, 1, 1] } } },
  sun: {
    components: {
      transform: { position: [4, 6, 3] },
      light: { type: "directional", shadow: true, target: "entity:box" },
    },
  },
};

describe("the lights of a document", () => {
  it("gives the showroom lights from its document, with the shadow box of the document", async () => {
    const builder = build(showroom());
    await builder.ready();
    const sun = lightOf<DirectionalLight>(builder, "sun");
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect(sun.intensity).toBe(2.2);
    expect(lightOf<HemisphereLight>(builder, "fill")).toBeInstanceOf(HemisphereLight);
    expect(lightOf<PointLight>(builder, "lantern-light").distance).toBe(4);
    frameLighting(builder.root, TIERS.high);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.width).toBe(2048);
    const camera = sun.shadow.camera;
    expect([camera.left, camera.right, camera.bottom, camera.top, camera.near, camera.far]).toEqual([
      -8, 8, -8, 8, 0.1, 40,
    ]);
    frameLighting(builder.root, TIERS.low);
    expect(sun.castShadow).toBe(false);
    expect(sun.shadow.mapSize.width).toBe(512);
  });

  it("points a directional light at its target entity", () => {
    const builder = build(sceneOf(STAGE));
    const sun = lightOf<DirectionalLight>(builder, "sun");
    builder.root.updateMatrixWorld(true);
    const from = new Vector3().setFromMatrixPosition(sun.matrixWorld);
    const to = new Vector3().setFromMatrixPosition(sun.target.matrixWorld);
    expect(to.distanceTo(new Vector3(1, 0.5, 0))).toBeLessThan(1e-9);
    expect(from.distanceTo(new Vector3(4, 6, 3))).toBeLessThan(1e-9);
  });

  it("fits the shadow camera of a directional light to the shadow casters", () => {
    const builder = build(sceneOf(STAGE));
    const sun = lightOf<DirectionalLight>(builder, "sun");
    frameLighting(builder.root, TIERS.high);
    const camera = sun.shadow.camera;
    camera.updateMatrixWorld(true);
    const inLight = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    // Each corner of the box is in the shadow camera.
    for (const x of [0.5, 1.5])
      for (const y of [0, 1])
        for (const z of [-0.5, 0.5]) {
          const p = inLight(x, y, z);
          expect(p.x).toBeGreaterThan(camera.left);
          expect(p.x).toBeLessThan(camera.right);
          expect(p.y).toBeGreaterThan(camera.bottom);
          expect(p.y).toBeLessThan(camera.top);
          expect(-p.z).toBeGreaterThan(camera.near);
        }
    // The far corner of the floor (a receiver) is in the depth range, and the box is narrower than the 10 m floor.
    expect(-inLight(-5, 0, -5).z).toBeLessThan(camera.far);
    expect(camera.right - camera.left).toBeLessThan(4);
    expect(camera.top - camera.bottom).toBeLessThan(4);
  });

  it("keeps a shadow camera value of the document and fits the others", () => {
    const stage = structuredClone(STAGE);
    (stage.sun?.components.light as Record<string, unknown>).shadowCamera = { left: -3, far: 30 };
    const builder = build(sceneOf(stage));
    const sun = lightOf<DirectionalLight>(builder, "sun");
    frameLighting(builder.root, TIERS.high);
    expect(sun.shadow.camera.left).toBe(-3);
    expect(sun.shadow.camera.far).toBe(30);
    expect(sun.shadow.camera.right).toBeLessThan(3);
  });

  it("fits the depth range of a spot and a point light", () => {
    const builder = build(
      sceneOf({
        ...STAGE,
        spot: {
          components: {
            transform: { position: [1, 4, 0] },
            light: { type: "spot", shadow: true, target: [1, 0, 0], angle: 0.5 },
          },
        },
        bulb: { components: { transform: { position: [-2, 2, 0] }, light: { type: "point", shadow: true } } },
      }),
    );
    frameLighting(builder.root, TIERS.ultra);
    const spot = lightOf<SpotLight>(builder, "spot");
    expect(spot.castShadow).toBe(true);
    expect(spot.shadow.mapSize.width).toBe(1024);
    // The top of the box is 3 m under the spot. The far corner of the floor is about 8 m away.
    expect(spot.shadow.camera.near).toBeCloseTo(2.7, 6);
    expect(spot.shadow.camera.far).toBeGreaterThan(Math.hypot(6, 4, 5));
    const bulb = lightOf<PointLight>(builder, "bulb");
    expect(bulb.shadow.mapSize.width).toBe(512);
    expect(bulb.shadow.camera.near).toBeGreaterThan(0.05);
    expect(bulb.shadow.camera.far).toBeGreaterThan(Math.hypot(7, 2, 5));
  });

  it("limits the lights and the shadows of each tier, in the order of the entities", () => {
    const entities: Entities = { sky: { components: { light: { type: "ambient" } } } };
    for (let index = 0; index < 10; index += 1) {
      entities[`lamp-${String(index)}`] = {
        components: { transform: { position: [index, 2, 0] }, light: { type: "point", shadow: index % 2 === 0 } },
      };
    }
    const builder = build(sceneOf({ ...STAGE, ...entities }));
    const lamps = Array.from({ length: 10 }, (_, index) => lightOf<PointLight>(builder, `lamp-${String(index)}`));
    const sun = lightOf<DirectionalLight>(builder, "sun");
    const count = () => ({
      shown: [sun, ...lamps].filter((light) => light.visible).length,
      shadows: [sun, ...lamps].filter((light) => light.castShadow).length,
    });
    frameLighting(builder.root, TIERS.high);
    expect(count()).toEqual({ shown: 8, shadows: 2 });
    // The sun is first in the document order: it keeps its shadow. lamp-0 has the second shadow.
    expect(sun.castShadow).toBe(true);
    expect(lamps[0]?.castShadow).toBe(true);
    expect(lamps[7]?.visible).toBe(false);
    frameLighting(builder.root, TIERS.low);
    expect(count()).toEqual({ shown: 2, shadows: 0 });
    expect(lightOf<AmbientLight>(builder, "sky").visible).toBe(true);
    // A higher tier shows the hidden lights again.
    frameLighting(builder.root, TIERS.ultra);
    expect(count()).toEqual({ shown: 11, shadows: 4 });
  });
});

describe("the cameras of a document", () => {
  const CAMERA_STAGE: Entities = {
    ...STAGE,
    view: {
      components: {
        transform: { position: [0, 1.5, 6] },
        camera: { fov: 20, target: "entity:box", safeFrame: { entities: ["entity:box"], margin: 0.5, maxFov: 80 } },
      },
    },
  };

  function viewOf(builder: SceneBuilder): { camera: PerspectiveCamera; value: CameraValue } {
    const camera = builder.camera("view");
    if (camera === undefined) throw new Error("no camera");
    const stored = builder.document().entities.view?.components.camera ?? {};
    return { camera, value: builder.registry.fill("camera", stored) as CameraValue };
  }

  /** True when each corner of a box is inside the view of the camera. */
  function shows(camera: PerspectiveCamera, box: Box3): boolean {
    camera.updateMatrixWorld(true);
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new Vector3(x, y, z).project(camera);
          if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1 || p.z < -1) return false;
        }
    return true;
  }

  it("widens the field of view to the safe frame of an entity, up to maxFov", () => {
    const builder = build(sceneOf(CAMERA_STAGE));
    const { camera, value } = viewOf(builder);
    const scene = builder.bounds();
    const bounds = (id: string) => builder.bounds(id);
    const safe = builder.bounds("box").expandByScalar(0.5);
    frameDocumentCamera(camera, value, scene, bounds, 16 / 9);
    expect(camera.fov).toBeGreaterThan(20);
    expect(shows(camera, safe)).toBe(true);
    const wide = camera.fov;
    // A portrait canvas needs a wider view. A far camera keeps its own field of view.
    frameDocumentCamera(camera, value, scene, bounds, 0.5);
    expect(camera.fov).toBeGreaterThan(wide);
    expect(shows(camera, safe)).toBe(true);
    expect(safeBoxes({ min: [0, 0, 0], max: [1, 1, 1], margin: 0.1 }, bounds)).toEqual([
      { min: [-0.1, -0.1, -0.1], max: [1.1, 1.1, 1.1] },
    ]);
  });

  it("takes the clip planes that the document does not give from the bounds of the scene", () => {
    const builder = build(sceneOf(CAMERA_STAGE));
    const { camera, value } = viewOf(builder);
    const scene = builder.bounds();
    frameDocumentCamera(camera, value, scene, (id) => builder.bounds(id), 1);
    // The farthest corner of the floor is about 11.2 m away. The camera is above the box of the scene (1 m high), so
    // near comes from the nearest corner of that box: the front edge of the floor, about 1.2 m away.
    expect(camera.far).toBeGreaterThan(11);
    expect(camera.far).toBeLessThan(12);
    expect(camera.near).toBeGreaterThan(0.1);
    expect(camera.near).toBeLessThan(1.2);
    expect(clipPlanes(camera, { ...value, near: 0.5, far: 50 }, scene)).toEqual({ near: 0.5, far: 50 });
    expect(clipPlanes(camera, { ...value, far: 50 }, new Box3())).toEqual({ near: camera.near, far: 50 });
  });
});
