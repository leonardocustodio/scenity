// SPDX-License-Identifier: Apache-2.0
// The inspect report and the debug layers of a scene document: a small document of shapes and models, and
// the robots of the characters sample (the joints of their skeletons). Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, type BufferGeometry } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, readValue, type SceneDocument } from "@scenity/scene";
import { SceneBuilder, type AssetKind, type AssetSource, type AssetValue } from "@scenity/runtime";
import { DebugLayers } from "../src/debugLayers";
import { bindDevPlugin, GENERIC_LAYERS } from "../src/devLayers";
import { inspectScene } from "../src/document/inspectScene";
import { SCENE_LAYERS, sceneDebugInput } from "../src/document/sceneLayers";
import { Wireframe } from "../src/document/wireframe";

const registry = builtinRegistry();
const CHARACTERS = join(import.meta.dir, "../../../samples/characters");

/** Each model is a group with one box mesh of 12 triangles. */
class BoxAssets implements AssetSource {
  load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the test has only models");
    const root = new Group();
    const body = new Group();
    body.name = "body";
    const box = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ name: "paint" }));
    box.name = "box";
    body.add(box);
    root.add(body);
    return Promise.resolve(root);
  }
}

/** The robot of the characters sample for each model reference. */
class RobotAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the test has only models");
    const data = readFileSync(join(CHARACTERS, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

function scene(entities: Record<string, unknown>): SceneDocument {
  const result = readValue({ format: "scenity.scene/1", id: "test", entities }, "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc as SceneDocument;
}

async function built(doc: SceneDocument, assets: AssetSource): Promise<SceneBuilder> {
  const builder = new SceneBuilder({ assets });
  builder.build(doc);
  await builder.ready();
  // The first frame makes the instance batches.
  const camera = new PerspectiveCamera(45, 1.6, 0.05, 50);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  builder.frame(camera);
  return builder;
}

const SMALL = {
  crate: {
    parent: null,
    index: 0,
    name: "Crate",
    tags: ["stack"],
    components: {
      transform: { position: [1, 0.25, 0] },
      shape: { kind: "box", size: [0.5, 0.5, 0.5] },
      socket: { points: { top: [0, 0.25, 0] } },
      obstacle: {},
    },
  },
  lid: {
    parent: "crate",
    index: 0,
    components: { transform: { position: [0, 0.3, 0] }, shape: { kind: "box", size: [0.5, 0.1, 0.5] } },
  },
  spot: { parent: null, index: 1, components: { transform: { position: [-1, 0, 1] }, standPoint: { facing: 0 } } },
  lamp: { parent: null, index: 2, components: { transform: { position: [0, 2, 0] }, light: { type: "point" } } },
  a: { parent: null, index: 3, components: { transform: { position: [-2, 0, -1] }, model: { asset: "asset:box" } } },
  b: { parent: null, index: 4, components: { transform: { position: [2, 0, -1] }, model: { asset: "asset:box" } } },
  eye: { parent: null, index: 5, components: { transform: { position: [0, 1, 4] }, camera: { fov: 40 } } },
};

describe("the inspect report of a scene document", () => {
  test("each entity has its world transform, bounds, components, sockets and stats", async () => {
    const report = inspectScene(await built(scene(SMALL), new BoxAssets()), 1200);
    expect(report.simMs).toBe(1200);
    expect(report.entities.map((entity) => entity.id)).toEqual(["a", "b", "crate", "eye", "lamp", "lid", "spot"]);
    const crate = report.entities.find((entity) => entity.id === "crate");
    expect(crate).toMatchObject({
      name: "Crate",
      parent: null,
      tags: ["stack"],
      components: ["obstacle", "shape", "socket", "transform"],
      visible: true,
      transform: { position: [1, 0.25, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      sockets: { top: [1, 0.5, 0] },
      joints: null,
      stats: { meshes: 1, triangles: 12, drawCalls: 1, instanced: false, lod: null },
    });
    // The box of the crate holds its lid (a child entity); the stats of the crate do not count the lid.
    expect(crate?.bounds).toEqual({ min: [0.75, 0, -0.25], max: [1.25, 0.6, 0.25] });
    // The own box of the crate (the surface of a snap) does not hold the lid.
    expect(crate?.ownBounds).toEqual({ min: [0.75, 0, -0.25], max: [1.25, 0.5, 0.25] });
    const lid = report.entities.find((entity) => entity.id === "lid");
    expect(lid?.transform.position).toEqual([1, 0.55, 0]);
    expect(report.entities.find((entity) => entity.id === "lamp")?.bounds).toBeNull();
    expect(report.entities.find((entity) => entity.id === "lamp")?.ownBounds).toBeNull();
  });

  test("a model entity has the part names of its model asset", async () => {
    const report = inspectScene(await built(scene(SMALL), new BoxAssets()), null);
    const a = report.entities.find((entity) => entity.id === "a");
    expect(a?.parts).toEqual({ meshes: ["body", "box"], materials: ["paint"] });
    expect(report.entities.find((entity) => entity.id === "crate")?.parts).toBeUndefined();
  });

  test("two copies of one model draw through an instance batch, and each counts one time", async () => {
    const report = inspectScene(await built(scene(SMALL), new BoxAssets()), null);
    for (const id of ["a", "b"]) {
      expect(report.entities.find((entity) => entity.id === id)?.stats).toEqual({
        meshes: 1,
        triangles: 12,
        drawCalls: 0,
        instanced: true,
        lod: null,
      });
    }
    // The crate and the lid draw themselves; the batch draws a and b.
    expect(report.totals).toEqual({ entities: 7, triangles: 48, drawCalls: 2 });
  });

  test("the robot of the characters sample gives the joints of its skeleton (node names)", async () => {
    const text = readFileSync(join(CHARACTERS, "scenes/main.scene.json"), "utf8");
    const result = readDocument(text, "scene", { registry });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const report = inspectScene(await built(result.doc, new RobotAssets()), null);
    const robot = report.entities.find((entity) => entity.id === "robot");
    const joints = Object.keys(robot?.joints ?? {});
    expect(joints.length).toBeGreaterThan(20);
    for (const name of ["Head", "Hips", "UpperArmL", "FootR"]) expect(joints).toContain(name);
    expect(robot?.stats.triangles).toBeGreaterThan(1000);
    expect(robot?.stats.instanced).toBe(false);
  });

  test("a character rig gives the canonical names of its bones", async () => {
    const text = readFileSync(join(CHARACTERS, "scenes/pickup.scene.json"), "utf8");
    const result = readDocument(text, "scene", { registry });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const report = inspectScene(await built(result.doc, new RobotAssets()), null);
    const robot = report.entities.find((entity) => entity.id === "robot");
    for (const name of ["head", "neck", "hips", "spine"]) expect(Object.keys(robot?.joints ?? {})).toContain(name);
    const cup = report.entities.find((entity) => entity.id === "cup");
    expect(Object.keys(cup?.sockets ?? {})).toEqual(["grip"]);
  });
});

function positions(geometry: BufferGeometry): number {
  return geometry.getAttribute("position").count;
}

describe("the debug layers of a scene document", () => {
  test("each generic layer has a drawer, and the scene layers draw from the graph", async () => {
    const builder = await built(scene(SMALL), new BoxAssets());
    const layers = new DebugLayers(["wireframe"]);
    layers.register(bindDevPlugin({ layers: SCENE_LAYERS }, () => ({ builder, frameCamera: null })));
    expect([...layers.names()].sort()).toEqual([...GENERIC_LAYERS].sort());
    const [lines, points] = layers.root.children as [Mesh, Mesh];
    const count = (names: string[]): [number, number] => {
      layers.set(names);
      layers.draw(sceneDebugInput(builder));
      return [positions(lines.geometry), positions(points.geometry)];
    };
    // Four entities with geometry (the crate, the lid, a and b): 12 edges each. The batch adds no box.
    expect(count(["bounds"])).toEqual([4 * 24, 0]);
    expect(count(["sockets"])).toEqual([6, 0]);
    // The crate obstacle (4 edges) and the stand point (3 lines).
    expect(count(["obstacles"])).toEqual([14, 0]);
    // The lamp is a point light: three rings of 16 lines and a cross. The camera: 4 rays, 4 edges and the up line.
    expect(count(["lights"])).toEqual([2 * (3 + 48), 0]);
    expect(count(["cameras"])).toEqual([2 * 9, 0]);
    // The normals of the meshes of the entities: 24 vertices per box, four boxes, no batch mesh.
    expect(count(["normals"])).toEqual([2 * 24 * 4, 0]);
    expect(count(["no-such-layer"])).toEqual([2 * 24 * 4, 0]);
    expect(layers.active).toBe(false);
  });

  test("the wireframe layer sets the switch of each material and resets it", async () => {
    const builder = await built(scene(SMALL), new BoxAssets());
    const materials = new Set<MeshStandardMaterial>();
    builder.root.traverse((node) => {
      if (node instanceof Mesh) materials.add(node.material as MeshStandardMaterial);
    });
    const wireframe = new Wireframe();
    wireframe.apply(builder.root, true);
    expect([...materials].every((material) => material.wireframe)).toBe(true);
    wireframe.apply(builder.root, false);
    expect([...materials].some((material) => material.wireframe)).toBe(false);
  });
});
