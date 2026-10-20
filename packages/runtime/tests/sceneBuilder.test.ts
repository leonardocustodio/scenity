// SPDX-License-Identifier: Apache-2.0
// The scene builder: the showroom document to a three.js graph, the incremental ops and the asset cache.
import { describe, expect, it } from "bun:test";
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  type Mesh,
  type MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { worldTransform, type SceneOp } from "@scenity/scene";
import { modelInstance, modelOverrideMaterials, SceneBuilder } from "../src";
import { FakeAssets, firstMesh, showroom } from "./sceneHelpers";

const TABLE_ASSET = "asset:01M4ZPXYG50NAV41FPDE38QB7E";
const LANTERN_ASSET = "asset:01M4ZPXYG26FPR940EDPJM9FCD";
const ROOTS = ["floor", "wall-back", "wall-left", "table", "shelf", "armchair", "ottoman", "coffee-table"];

async function built() {
  const assets = new FakeAssets();
  const builder = new SceneBuilder({ assets });
  builder.build(showroom());
  await builder.ready();
  return { assets, builder };
}

function applied(builder: SceneBuilder, ops: SceneOp[]): void {
  const result = builder.apply(ops);
  if (!result.ok) throw new Error(result.reason);
}

function worldOf(builder: SceneBuilder, id: string) {
  const object = builder.entityObject(id)!;
  builder.root.updateMatrixWorld(true);
  return { position: object.getWorldPosition(new Vector3()), rotation: object.getWorldQuaternion(new Quaternion()) };
}

function onDispose(item: BufferGeometry | Material): () => boolean {
  let done = false;
  item.addEventListener("dispose", () => (done = true));
  return () => done;
}

describe("SceneBuilder: build", () => {
  it("makes one group for each entity, with the hierarchy and the order of the document", async () => {
    const { builder } = await built();
    expect(builder.entityIds()).toHaveLength(14);
    const roots = builder.root.children.map((child) => child.name);
    expect(roots).toEqual([...ROOTS, "sun", "fill", "front", "top"]);
    const lantern = builder.entityObject("lantern")!;
    expect(lantern.parent).toBe(builder.entityObject("table")!);
    expect(lantern.userData.entity).toBe("lantern");
    expect(builder.entityObject("lantern-light")!.parent).toBe(lantern);
  });

  it("loads each model one time and puts a clone under its entity", async () => {
    const { assets, builder } = await built();
    expect(assets.totalLoads()).toBe(6);
    expect([...assets.loads.values()].every((count) => count === 1)).toBe(true);
    const instance = modelInstance(builder.componentObject("table", "model")!);
    expect(firstMesh(instance)?.geometry).toBe(assets.model(TABLE_ASSET).geometry);
    expect(firstMesh(instance)?.castShadow).toBe(true);
  });

  it("gives the world transforms of @scenity/scene", async () => {
    const { builder } = await built();
    const doc = builder.document();
    for (const id of builder.entityIds()) {
      const expected = worldTransform(doc, id)!;
      const actual = worldOf(builder, id);
      actual.position.toArray().forEach((value, axis) => expect(value).toBeCloseTo(expected.position[axis]!, 6));
      const dot = Math.abs(actual.rotation.dot(new Quaternion(...expected.rotation)));
      expect(dot).toBeCloseTo(1, 6);
    }
    const lantern = worldOf(builder, "lantern-light").position;
    expect(lantern.distanceTo(new Vector3(...worldTransform(doc, "lantern-light")!.position))).toBeLessThan(1e-6);
  });

  it("makes the lights of the document", async () => {
    const { builder } = await built();
    const sun = builder.componentObject("sun", "light");
    expect(sun).toBeInstanceOf(DirectionalLight);
    const directional = sun as DirectionalLight;
    expect(directional.castShadow).toBe(true);
    expect(directional.intensity).toBe(2.2);
    // The light points along -Z of the entity.
    builder.root.updateMatrixWorld(true);
    const direction = directional.target
      .getWorldPosition(new Vector3())
      .sub(directional.getWorldPosition(new Vector3()));
    const minusZ = new Vector3(0, 0, -1).applyQuaternion(worldOf(builder, "sun").rotation);
    expect(direction.distanceTo(minusZ)).toBeLessThan(1e-6);
    expect(builder.componentObject("fill", "light")).toBeInstanceOf(HemisphereLight);
    const point = builder.componentObject("lantern-light", "light") as PointLight;
    expect(point).toBeInstanceOf(PointLight);
    expect(point.distance).toBe(4);
    expect(point.castShadow).toBe(false);
    expect(point.color.getHexString()).toBe("ffd6a0");
  });

  it("makes the document cameras, with a lookup by ID and by name", async () => {
    const { builder } = await built();
    expect([...builder.cameras().keys()]).toEqual(["front", "top"]);
    const front = builder.camera("front")!;
    expect(builder.camera("Front camera")).toBe(front);
    expect(front.fov).toBe(45);
    builder.root.updateMatrixWorld(true);
    const position = front.getWorldPosition(new Vector3());
    const expected = new Vector3(-0.2, 0.6, -0.4).sub(position).normalize();
    expect(front.getWorldDirection(new Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
  });

  it("gives the scene-level values for the host", async () => {
    const { builder } = await built();
    const environment = builder.environment();
    expect(environment.toneMapping).toBe(ACESFilmicToneMapping);
    expect(environment.exposure).toBe(1);
    expect(environment.map).toBe("asset:01M4ZPXYG6S1R09H3MDXC5VXKQ");
    expect(environment.mapIntensity).toBe(0.5);
    expect(environment.background.getHexString()).toBe("1a2433");
    expect(environment.fog).toBeNull();
    applied(builder, [
      { op: "set", path: "/environment/fog", value: { type: "exp2", colour: "#808080", density: 0.1 } },
    ]);
    expect(builder.environment().fog).toBeInstanceOf(FogExp2);
    expect(builder.environment().revision).toBe(environment.revision + 1);
  });

  it("makes a plane in the XZ plane that faces +Y, and gives bounds", async () => {
    const { builder } = await built();
    const floor = builder.bounds("floor");
    expect(floor.min.distanceTo(new Vector3(-4, 0, -3))).toBeLessThan(1e-9);
    expect(floor.max.distanceTo(new Vector3(4, 0, 3))).toBeLessThan(1e-9);
    const normal = (builder.componentObject("floor", "shape") as Mesh).geometry.getAttribute("normal");
    expect(new Vector3(normal.getX(0), normal.getY(0), normal.getZ(0)).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(
      1e-9,
    );
    const scene = builder.bounds();
    expect(scene.min.y).toBeCloseTo(0, 9);
    expect(scene.max.y).toBeCloseTo(3, 6);
    expect(builder.bounds("nothing").isEmpty()).toBe(true);
  });
});

describe("SceneBuilder: apply", () => {
  it("moves the table with a set op and keeps the same objects", async () => {
    const { assets, builder } = await built();
    const table = builder.entityObject("table");
    const holder = builder.componentObject("table", "model");
    const mesh = firstMesh(holder);
    const others = builder.entityIds().map((id) => builder.entityObject(id));
    applied(builder, [{ op: "set", path: "/entities/table/components/transform/position/0", value: 2 }]);
    expect(builder.entityObject("table")).toBe(table);
    expect(builder.componentObject("table", "model")).toBe(holder);
    expect(firstMesh(holder)).toBe(mesh);
    expect(builder.entityIds().map((id) => builder.entityObject(id))).toEqual(others);
    expect(table!.position.x).toBe(2);
    expect(worldOf(builder, "lantern-light").position.x).toBeCloseTo(2.35, 6);
    expect(assets.totalLoads()).toBe(6);
    expect(builder.document().entities.table?.components.transform).toEqual({ position: [2, 0, -0.9] });
  });

  it("adds and removes components", async () => {
    const { builder } = await built();
    applied(builder, [{ op: "addComponent", id: "table", component: "visibility", value: { visible: false } }]);
    expect(builder.entityObject("table")!.visible).toBe(false);
    applied(builder, [{ op: "removeComponent", id: "table", component: "visibility" }]);
    expect(builder.entityObject("table")!.visible).toBe(true);
    applied(builder, [{ op: "addComponent", id: "fill", component: "shape", value: { kind: "sphere" } }]);
    const sphere = builder.componentObject("fill", "shape") as Mesh;
    expect(sphere.parent).toBe(builder.entityObject("fill")!);
    const geometryGone = onDispose(sphere.geometry);
    applied(builder, [{ op: "removeComponent", id: "fill", component: "shape" }]);
    expect(geometryGone()).toBe(true);
    expect(sphere.parent).toBeNull();
    expect(builder.componentIds("fill")).toEqual(["light", "transform"]);
  });

  it("updates a light in place and makes a new light for a new type", async () => {
    const { builder } = await built();
    const light = builder.componentObject("lantern-light", "light") as PointLight;
    applied(builder, [{ op: "set", path: "/entities/lantern-light/components/light/intensity", value: 3 }]);
    expect(builder.componentObject("lantern-light", "light")).toBe(light);
    expect(light.intensity).toBe(3);
    applied(builder, [{ op: "set", path: "/entities/lantern-light/components/light/type", value: "spot" }]);
    const spot = builder.componentObject("lantern-light", "light")!;
    expect(spot).not.toBe(light);
    expect((spot as unknown as { isSpotLight: boolean }).isSpotLight).toBe(true);
    expect(light.parent).toBeNull();
  });

  it("disposes the geometry and the materials of a removed entity", async () => {
    const { builder } = await built();
    const floor = builder.componentObject("floor", "shape") as Mesh<BufferGeometry, MeshStandardMaterial>;
    const geometryGone = onDispose(floor.geometry);
    const materialGone = onDispose(floor.material);
    applied(builder, [{ op: "remove", id: "floor" }]);
    expect(geometryGone()).toBe(true);
    expect(materialGone()).toBe(true);
    expect(builder.entityObject("floor")).toBeUndefined();
    expect(builder.root.children.map((child) => child.name).slice(0, 2)).toEqual(["wall-back", "wall-left"]);
  });

  it("releases an asset when its last user goes, and keeps a shared asset", async () => {
    const { assets, builder } = await built();
    const twin = { parent: null, index: 0, components: { model: { asset: TABLE_ASSET } } };
    applied(builder, [{ op: "add", id: "twin", entity: twin }]);
    await builder.ready();
    expect(assets.loads.get(TABLE_ASSET)).toBe(1);
    expect(builder.assetUsers(TABLE_ASSET)).toBe(2);
    const table = assets.model(TABLE_ASSET);
    const lantern = assets.model(LANTERN_ASSET);
    applied(builder, [{ op: "remove", id: "table" }]);
    // The lantern was a child of the table, and the only user of its asset.
    expect(builder.entityObject("lantern")).toBeUndefined();
    expect(lantern.disposed).toEqual({ geometry: true, material: true, texture: true });
    expect(table.disposed).toEqual({ geometry: false, material: false, texture: false });
    expect(assets.released).toEqual([LANTERN_ASSET]);
    applied(builder, [{ op: "remove", id: "twin" }]);
    expect(table.disposed).toEqual({ geometry: true, material: true, texture: true });
    expect(assets.released).toEqual([LANTERN_ASSET, TABLE_ASSET]);
    expect(builder.assetUsers(TABLE_ASSET)).toBe(0);
  });

  it("disposes an asset whose last user goes before the end of its load", async () => {
    const assets = new FakeAssets();
    const builder = new SceneBuilder({ assets });
    builder.build(showroom());
    applied(builder, [{ op: "remove", id: "shelf" }]);
    await builder.ready();
    const shelf = assets.model("asset:01M4ZPXYG4RJ5N3H08MAHE8762");
    expect(shelf.disposed.geometry).toBe(true);
    expect(shelf.root.parent).toBeNull();
  });

  it("re-parents an entity with a move op", async () => {
    const { builder } = await built();
    const lantern = builder.entityObject("lantern")!;
    const before = worldOf(builder, "lantern").position;
    applied(builder, [{ op: "move", id: "lantern", parent: "coffee-table", index: 0 }]);
    expect(builder.entityObject("lantern")).toBe(lantern);
    expect(lantern.parent).toBe(builder.entityObject("coffee-table")!);
    expect(worldOf(builder, "lantern").position.distanceTo(before)).toBeGreaterThan(0.1);
    applied(builder, [{ op: "move", id: "lantern", parent: null, index: 0 }]);
    expect(builder.root.children[0]).toBe(lantern);
    expect(builder.root.children[1]?.name).toBe("floor");
  });

  it("clones a material for an override and disposes the clone with the entity", async () => {
    const { assets, builder } = await built();
    const path = "/entities/armchair/components/model/materials";
    applied(builder, [{ op: "set", path, value: { wood: { colour: "#ff0000", roughness: 0.2, opacity: 0.5 } } }]);
    const holder = builder.componentObject("armchair", "model")!;
    const material = firstMesh(holder)!.material as MeshStandardMaterial;
    const source = assets.model("asset:01M4ZPXYG09E9YQGV2TVA22WQ4");
    expect(material).not.toBe(source.material);
    expect(material.color.getHexString()).toBe("ff0000");
    expect(material.transparent).toBe(true);
    expect(material.map).toBe(source.texture);
    expect(modelOverrideMaterials(holder)).toEqual([material]);
    const cloneGone = onDispose(material);
    applied(builder, [{ op: "set", path }]);
    expect(cloneGone()).toBe(true);
    expect(firstMesh(holder)!.material).toBe(source.material);
    expect(source.disposed.material).toBe(false);
  });

  it("refuses a bad op and keeps the graph", async () => {
    const { builder } = await built();
    const doc = builder.document();
    const result = builder.apply([
      { op: "set", path: "/entities/table/components/transform/position/0", value: 5 },
      { op: "remove", id: "nothing" },
    ]);
    expect(result.ok).toBe(false);
    expect(builder.document()).toBe(doc);
    expect(builder.entityObject("table")!.position.x).toBe(1.6);
  });

  it("records a failed load as a warning, and dispose releases each asset", async () => {
    const assets = new FakeAssets();
    assets.failing.add(TABLE_ASSET);
    const builder = new SceneBuilder({ assets });
    builder.build(showroom());
    await builder.ready();
    expect(builder.warnings()).toEqual([`table: the model "${TABLE_ASSET}" did not load: no asset ${TABLE_ASSET}`]);
    builder.dispose();
    expect(builder.root.children).toHaveLength(0);
    expect(assets.released).toHaveLength(5);
    expect(() => builder.document()).toThrow();
  });
});
