// SPDX-License-Identifier: Apache-2.0
// The instance batches of the scene builder (src/scene/instancing.ts): the entities of one model draw as one
// InstancedMesh for each mesh part. A patch moves, adds and removes an instance. The pick maps an instance to its
// entity. The sphere of a batch holds each instance, so three.js culls it correctly.
import { describe, expect, it } from "bun:test";
import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint16BufferAttribute,
  Vector3,
  type Mesh,
  type Object3D,
} from "three";
import type { SceneDocument, SceneOp } from "@scenity/scene";
import { modelInstance, SceneBuilder, type AssetKind, type AssetSource, type AssetValue } from "../src";
import { HIDDEN_LAYER } from "../src/scene/instancing";
import { GraphPicker } from "../src/scene/pick";
import { screenOf, SURFACE, testCore } from "./pickHelpers";
import { FakeAssets, firstMesh } from "./sceneHelpers";

const CRATE = "asset:crate";
const LAMP = "asset:lamp";

type Components = Record<string, unknown>;

/** A row of crates along X at z = -6, a lamp, and a red crate (an override: its own batch key). */
function crates(count: number, more: Record<string, Components> = {}): SceneDocument {
  const entities: SceneDocument["entities"] = {};
  for (let i = 0; i < count; i += 1) {
    entities[`crate-${String(i)}`] = {
      parent: null,
      index: i,
      components: { transform: { position: [i - count / 2, 0, -6] }, model: { asset: CRATE } },
    };
  }
  entities.lamp = {
    parent: null,
    index: count,
    components: { transform: { position: [0, 2, -8] }, model: { asset: LAMP } },
  };
  entities.red = {
    parent: null,
    index: count + 1,
    components: {
      transform: { position: [0, 2, -6] },
      model: { asset: CRATE, materials: { wood: { colour: "#ff0000" } } },
    },
  };
  Object.entries(more).forEach(([id, components], index) => {
    entities[id] = { parent: null, index: count + 2 + index, components };
  });
  return { format: "scenity.scene/1", id: "crates", entities };
}

function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera(50, SURFACE.width / SURFACE.height, 0.1, 100);
  view.position.set(0, 1, 2);
  view.updateMatrixWorld(true);
  return view;
}

async function built(doc: SceneDocument, assets: AssetSource = new FakeAssets()) {
  const builder = new SceneBuilder({ assets });
  builder.build(doc);
  await builder.ready();
  const view = camera();
  builder.frame(view);
  return { builder, view };
}

function applied(builder: SceneBuilder, ops: SceneOp[]): void {
  const result = builder.apply(ops);
  if (!result.ok) throw new Error(result.reason);
}

/** The batches of the builder: the InstancedMesh objects under the "instances" group. */
function batches(builder: SceneBuilder): InstancedMesh[] {
  const holder = builder.root.children.find((child) => child.name === "instances");
  return (holder?.children ?? []).filter((child): child is InstancedMesh => child instanceof InstancedMesh);
}

function cloneMesh(builder: SceneBuilder, id: string): Mesh {
  const mesh = firstMesh(modelInstance(builder.componentObject(id, "model")!));
  if (mesh === undefined) throw new Error(`${id} has no mesh`);
  return mesh;
}

/** The world matrix of each instance of a batch, by entity. */
function instanceWorlds(batch: InstancedMesh): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const entities = batch.userData.instances as string[];
  for (let i = 0; i < batch.count; i += 1) {
    out.set(entities[i]!, new Matrix4().multiplyMatrices(batch.matrixWorld, batch.getMatrixAt(i, new Matrix4())));
  }
  return out;
}

function expectSphereHolds(batch: InstancedMesh, point: Vector3): void {
  const sphere = batch.boundingSphere!.clone().applyMatrix4(batch.matrixWorld);
  expect(sphere.distanceToPoint(point)).toBeLessThanOrEqual(1e-6);
}

describe("SceneBuilder: instance batches", () => {
  it("draws the entities of one model and one override key as one batch", async () => {
    const { builder } = await built(crates(5));
    const [batch, ...rest] = batches(builder);
    expect(rest).toHaveLength(0);
    expect(batch!.count).toBe(5);
    expect([...(batch!.userData.instances as string[])].sort()).toEqual(
      ["crate-0", "crate-1", "crate-2", "crate-3", "crate-4"].sort(),
    );
    expect(batch!.geometry).toBe(cloneMesh(builder, "crate-0").geometry);
    expect(builder.view()).toMatchObject({ instances: 5, batches: 1 });
    // The clones stay under their entities on the hidden layer. The lamp and the red crate draw with their clones.
    expect(cloneMesh(builder, "crate-3").layers.isEnabled(HIDDEN_LAYER)).toBe(true);
    expect(cloneMesh(builder, "crate-3").layers.isEnabled(0)).toBe(false);
    expect(cloneMesh(builder, "red").layers.isEnabled(0)).toBe(true);
    expect(cloneMesh(builder, "lamp").layers.isEnabled(0)).toBe(true);
  });

  it("puts each instance at the world matrix of its clone mesh", async () => {
    const { builder } = await built(crates(4));
    const worlds = instanceWorlds(batches(builder)[0]!);
    for (const [id, world] of worlds) {
      const expected = cloneMesh(builder, id).matrixWorld;
      world.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index]!, 6));
    }
  });

  it("moves, adds and removes an instance with a patch, and keeps the sphere round each instance", async () => {
    const { builder, view } = await built(crates(4));
    applied(builder, [{ op: "set", path: "/entities/crate-1/components/transform/position", value: [40, 0, -6] }]);
    builder.frame(view);
    let batch = batches(builder)[0]!;
    const moved = instanceWorlds(batch).get("crate-1")!;
    expect(new Vector3().setFromMatrixPosition(moved).x).toBeCloseTo(40, 6);
    expectSphereHolds(batch, new Vector3(40, 0.25, -6));
    expectSphereHolds(batch, new Vector3(-2, 0.25, -6));

    const added = {
      parent: null,
      index: 6,
      components: { transform: { position: [0, 0, -20] }, model: { asset: CRATE } },
    };
    applied(builder, [{ op: "add", id: "new-crate", entity: added }]);
    await builder.ready();
    builder.frame(view);
    batch = batches(builder)[0]!;
    expect(batch.count).toBe(5);
    expect(instanceWorlds(batch).has("new-crate")).toBe(true);
    expectSphereHolds(batch, new Vector3(0, 0.25, -20));

    applied(builder, [{ op: "remove", id: "crate-2" }]);
    builder.frame(view);
    batch = batches(builder)[0]!;
    expect(batch.count).toBe(4);
    expect(instanceWorlds(batch).has("crate-2")).toBe(false);
    expect(builder.view().instances).toBe(4);
  });

  it("hides the instance of a hidden entity", async () => {
    const { builder, view } = await built(crates(3));
    applied(builder, [{ op: "addComponent", id: "crate-0", component: "visibility", value: { visible: false } }]);
    builder.frame(view);
    const batch = batches(builder)[0]!;
    expect(batch.count).toBe(2);
    expect(instanceWorlds(batch).has("crate-0")).toBe(false);
  });

  it("ends the batch when one entity is left, and gives the clone its layer back", async () => {
    const { builder, view } = await built(crates(2));
    applied(builder, [{ op: "remove", id: "crate-0" }]);
    builder.frame(view);
    expect(batches(builder)).toHaveLength(0);
    expect(builder.root.children.some((child) => child.name === "instances")).toBe(false);
    expect(cloneMesh(builder, "crate-1").layers.isEnabled(0)).toBe(true);
  });

  it("keeps an entity with an animator out of the batches", async () => {
    const doc = crates(3, { walker: { transform: { position: [3, 0, -6] }, model: { asset: CRATE }, animator: {} } });
    const { builder } = await built(doc);
    expect(batches(builder)[0]!.count).toBe(3);
    expect(cloneMesh(builder, "walker").layers.isEnabled(0)).toBe(true);
  });

  it("maps a pick of an instance back to its entity", async () => {
    const { builder, view } = await built(crates(5));
    const picker = new GraphPicker();
    for (const id of ["crate-1", "crate-3"]) {
      const at = new Vector3().setFromMatrixPosition(cloneMesh(builder, id).matrixWorld).add(new Vector3(0, 0.25, 0));
      const [x, y] = screenOf(view, [at.x, at.y, at.z]);
      const hit = picker.pick(builder, view, x, y, SURFACE.width, SURFACE.height);
      expect(hit?.entity).toBe(id);
      expect(hit?.component).toBe("model");
      expect(hit?.target).toEqual({ kind: "node", id: "body" });
    }
  });

  it("swaps the geometry of a batch on a hot reload of the model", async () => {
    const assets = new FakeAssets();
    const { builder, view } = await built(crates(3), assets);
    const before = assets.model(CRATE).geometry;
    builder.reload([CRATE]);
    await builder.ready();
    builder.frame(view);
    const after = assets.model(CRATE).geometry;
    expect(after).not.toBe(before);
    expect(batches(builder)[0]!.geometry).toBe(after);
    expect(batches(builder)[0]!.count).toBe(3);
  });

  it("gives the frustum of three.js a sphere that holds a far instance", async () => {
    const { builder, view } = await built(crates(3));
    applied(builder, [{ op: "set", path: "/entities/crate-2/components/transform/position", value: [0, 0, -60] }]);
    builder.frame(view);
    const batch = batches(builder)[0]!;
    // A camera that sees only the far instance still draws the batch.
    const far = new PerspectiveCamera(10, 1, 0.1, 200);
    far.position.set(0, 0.25, -50);
    far.lookAt(0, 0.25, -60);
    far.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(far.projectionMatrix, far.matrixWorldInverse),
    );
    expect(frustum.intersectsObject(batch)).toBe(true);
  });

  it("counts the entities in the view", async () => {
    const { builder } = await built(crates(5));
    const behind = new PerspectiveCamera(50, 1.6, 0.1, 100);
    behind.position.set(0, 1, 2);
    behind.lookAt(0, 1, 10);
    behind.updateMatrixWorld(true);
    expect(builder.view().visibleEntities).toBe(7);
    expect(builder.frame(behind).visibleEntities).toBe(0);
  });

  it("gives the counts in the stats of the document core", async () => {
    const core = testCore(new FakeAssets());
    await core.load({ documents: { scene: crates(6) } });
    const stats = core.stats(false);
    expect(stats.instances).toBe(6);
    expect(stats.visibleEntities).toBeGreaterThan(0);
    core.dispose();
  });
});

/** A model with one skinned mesh and one bone. */
class SkinnedAssets implements AssetSource {
  load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") return Promise.resolve(new Texture());
    const geometry = new BoxGeometry(0.5, 0.5, 0.5);
    const count = geometry.attributes.position!.count;
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Array<number>(count * 4).fill(0), 4));
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute(new Array<number>(count * 4).fill(0).fill(1, 0, 1), 4),
    );
    const bone = new Bone();
    const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new Skeleton([bone]));
    const root = new Group();
    root.add(mesh);
    return Promise.resolve(root);
  }
}

describe("SceneBuilder: skinned meshes and the frustum", () => {
  it("keeps skinned models out of the batches and turns off their frustum culling", async () => {
    const doc = crates(3);
    const { builder } = await built(doc, new SkinnedAssets());
    expect(batches(builder)).toHaveLength(0);
    let skinned: Object3D | undefined;
    modelInstance(builder.componentObject("crate-0", "model")!)?.traverse((node) => {
      if (node instanceof SkinnedMesh) skinned = node;
    });
    expect(skinned?.frustumCulled).toBe(false);
  });
});
