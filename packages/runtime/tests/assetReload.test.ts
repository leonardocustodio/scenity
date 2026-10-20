// SPDX-License-Identifier: Apache-2.0
// The hot reload of assets in dev: the builder loads an asset again and puts the new value into each entity that uses
// it. Then it disposes the previous geometries, materials and textures.
import { describe, expect, it } from "bun:test";
import { modelInstance, SceneBuilder } from "../src";
import { refersTo } from "../src/scene/graph";
import { FakeAssets, firstMesh, showroom } from "./sceneHelpers";

const TABLE_ASSET = "asset:01M4ZPXYG50NAV41FPDE38QB7E";
const LANTERN_ASSET = "asset:01M4ZPXYG26FPR940EDPJM9FCD";

async function built() {
  const assets = new FakeAssets();
  const builder = new SceneBuilder({ assets });
  builder.build(showroom());
  await builder.ready();
  return { assets, builder };
}

function tableMesh(builder: SceneBuilder) {
  return firstMesh(modelInstance(builder.componentObject("table", "model")!));
}

describe("SceneBuilder.reload", () => {
  it("swaps the new model into its entity and disposes the old one", async () => {
    const { assets, builder } = await built();
    const old = assets.model(TABLE_ASSET);
    const lantern = builder.entityObject("lantern")!;
    builder.reload([TABLE_ASSET]);
    await builder.ready();
    expect(assets.loads.get(TABLE_ASSET)).toBe(2);
    expect(assets.loads.get(LANTERN_ASSET)).toBe(1);
    const fresh = assets.model(TABLE_ASSET);
    expect(fresh).not.toBe(old);
    expect(tableMesh(builder)?.geometry).toBe(fresh.geometry);
    expect(old.disposed).toEqual({ geometry: true, material: true, texture: true });
    expect(fresh.disposed).toEqual({ geometry: false, material: false, texture: false });
    expect(builder.assetUsers(TABLE_ASSET)).toBe(1);
    // The child entity keeps its object and its place: the part comes first, the children after it.
    const table = builder.entityObject("table")!;
    expect(builder.entityObject("lantern")).toBe(lantern);
    expect(lantern.parent).toBe(table);
    expect(table.children[0]?.userData.component).toBe("model");
  });

  it("keeps the old model and warns when the new load fails", async () => {
    const { assets, builder } = await built();
    const old = assets.model(TABLE_ASSET);
    assets.failing.add(TABLE_ASSET);
    builder.reload([TABLE_ASSET]);
    await builder.ready();
    expect(tableMesh(builder)?.geometry).toBe(old.geometry);
    expect(old.disposed.geometry).toBe(false);
    expect(builder.warnings().at(-1)).toContain(TABLE_ASSET);
  });

  it("loads nothing for an asset that no entity uses", async () => {
    const { assets, builder } = await built();
    const loads = assets.totalLoads();
    builder.reload(["asset:01M4ZPXYG0000000000000000"]);
    await builder.ready();
    expect(assets.totalLoads()).toBe(loads);
  });

  it("finds an asset reference at any depth of a component value", () => {
    const refs = new Set([TABLE_ASSET]);
    expect(refersTo({ asset: TABLE_ASSET }, refs)).toBe(true);
    expect(refersTo({ clipSource: { asset: TABLE_ASSET } }, refs)).toBe(true);
    expect(refersTo({ list: [1, TABLE_ASSET] }, refs)).toBe(true);
    expect(refersTo({ asset: LANTERN_ASSET, n: 1 }, refs)).toBe(false);
    expect(refersTo(null, refs)).toBe(false);
  });
});
