// SPDX-License-Identifier: Apache-2.0
// The materials of the material assets: the three.js material of each type, the material cache over the
// asset cache, the material asset of a shape, and the material overrides per part of a model (a mesh key, a material
// key, a material asset) with an incremental patch and a dispose.
import { describe, expect, it } from "bun:test";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Material,
} from "three";
import type { MaterialDocument, SceneDocument, SceneOp } from "@scenity/scene";
import {
  AssetCache,
  makeMaterial,
  MaterialCache,
  modelInstance,
  modelOverrideMaterials,
  SceneBuilder,
  type AssetKind,
  type AssetSource,
  type AssetValue,
} from "../src";
import { parseMaterial } from "../src/scene/manifestAssets";

const RED = "asset:mat-red-0000001";
const BLUE = "asset:mat-blue-000001";
const CHECKER = "asset:tex-checker-01";
const CHAIR = "asset:model-chair-01";

const DOCS: Readonly<Record<string, MaterialDocument>> = {
  [RED]: {
    format: "scenity.material/1",
    type: "standard",
    colour: "#ff0000",
    roughness: 0.3,
    maps: { colour: { texture: CHECKER, repeat: [2, 1] }, normal: { texture: CHECKER, colorSpace: "linear" } },
  },
  [BLUE]: { format: "scenity.material/1", type: "phong", colour: "#0000ff", shininess: 50 },
};

/** A fake source: two material documents, a texture and a chair with a seat node and a leg mesh. */
class MaterialAssets implements AssetSource {
  readonly loads: string[] = [];
  readonly released: string[] = [];

  load(ref: string, kind: AssetKind): Promise<AssetValue> {
    this.loads.push(`${kind}|${ref}`);
    if (kind === "material") {
      const doc = DOCS[ref];
      return doc === undefined ? Promise.reject(new Error(`no material ${ref}`)) : Promise.resolve({ material: doc });
    }
    if (kind === "texture") return Promise.resolve(new Texture());
    const chair = new Group();
    const seat = new Group();
    seat.name = "seat";
    const cushion = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: "fabric" }));
    cushion.name = "cushion";
    seat.add(cushion);
    const leg = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: "metal" }));
    leg.name = "leg";
    chair.add(seat, leg);
    return Promise.resolve(chair);
  }

  release(ref: string, kind: AssetKind): void {
    this.released.push(`${kind}|${ref}`);
  }
}

function scene(components: Record<string, unknown>): SceneDocument {
  return {
    format: "scenity.scene/1",
    id: "main",
    entities: { item: { parent: null, index: 0, components } },
  };
}

async function builderWith(components: Record<string, unknown>) {
  const assets = new MaterialAssets();
  const builder = new SceneBuilder({ assets });
  builder.build(scene(components));
  await builder.ready();
  return { assets, builder };
}

async function apply(builder: SceneBuilder, ops: SceneOp[]): Promise<void> {
  const result = builder.apply(ops);
  if (!result.ok) throw new Error(result.reason);
  await builder.ready();
}

function meshNamed(builder: SceneBuilder, name: string): Mesh {
  const instance = modelInstance(builder.componentObject("item", "model")!)!;
  return instance.getObjectByName(name) as Mesh;
}

describe("makeMaterial", () => {
  it("makes the three.js material of each type with its values", () => {
    const of = (doc: Omit<MaterialDocument, "format">) =>
      makeMaterial({ format: "scenity.material/1", ...doc }, new Map());
    const physical = of({ type: "physical", clearcoat: 1, sheenColour: "#ffffff", ior: 1.4 }) as MeshPhysicalMaterial;
    expect(physical).toBeInstanceOf(MeshPhysicalMaterial);
    expect([physical.clearcoat, physical.ior, physical.sheenColor.getHexString()]).toEqual([1, 1.4, "ffffff"]);
    const phong = of({ type: "phong", specular: "#ff0000", shininess: 12 }) as MeshPhongMaterial;
    expect([phong.specular.getHexString(), phong.shininess]).toEqual(["ff0000", 12]);
    expect(of({ type: "lambert", side: "double" })).toBeInstanceOf(MeshLambertMaterial);
    expect(of({ type: "lambert", side: "double" }).side).toBe(2);
    const unlit = of({ type: "unlit", opacity: 0.5 });
    expect(unlit).toBeInstanceOf(MeshBasicMaterial);
    expect([unlit.opacity, unlit.transparent]).toEqual([0.5, true]);
    const standard = of({
      type: "standard",
      roughness: 0.2,
      metalness: 1,
      normalScale: [2, -1],
    }) as MeshStandardMaterial;
    expect(standard.constructor).toBe(MeshStandardMaterial);
    expect([standard.roughness, standard.metalness, standard.normalScale.toArray()]).toEqual([0.2, 1, [2, -1]]);
  });

  it("gives each slot a copy of the texture with the colour space, the wrap and the repeat", () => {
    const source = new Texture();
    const material = makeMaterial(DOCS[RED]!, new Map([[CHECKER, source]])) as MeshStandardMaterial;
    expect(material.map).not.toBe(source);
    expect(material.map?.source).toBe(source.source);
    expect([material.map?.colorSpace, material.normalMap?.colorSpace]).toEqual([SRGBColorSpace, NoColorSpace]);
    expect([material.map?.wrapS, material.map?.repeat.toArray()]).toEqual([RepeatWrapping, [2, 1]]);
    expect(material.normalMap?.repeat.toArray()).toEqual([1, 1]);
  });

  it("refuses a document with a value of another type", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ format: "scenity.material/1", type: "unlit", roughness: 1 }),
    );
    expect(() => parseMaterial(RED, bytes.buffer)).toThrow("/roughness: a unlit material has no roughness");
  });
});

describe("the material cache", () => {
  it("shares one material per asset and frees it with its last user", async () => {
    const source = new MaterialAssets();
    const assets = new AssetCache(source);
    const cache = new MaterialCache(assets);
    const [first, second] = await Promise.all([cache.acquire(RED), cache.acquire(RED)]);
    expect(first).toBe(second);
    expect(source.loads).toEqual([`material|${RED}`, `texture|${CHECKER}`]);
    const map = (first as MeshStandardMaterial).map!;
    let disposed = 0;
    first.addEventListener("dispose", () => (disposed += 1));
    map.addEventListener("dispose", () => (disposed += 1));
    cache.release(RED);
    expect([disposed, cache.users(RED), assets.users(CHECKER, "texture")]).toEqual([0, 1, 1]);
    cache.release(RED);
    expect([disposed, cache.users(RED), assets.users(CHECKER, "texture")]).toEqual([2, 0, 0]);
    expect(source.released).toEqual([`texture|${CHECKER}`, `material|${RED}`]);
  });

  it("a release before the end of the load frees the assets of the load", async () => {
    const source = new MaterialAssets();
    const assets = new AssetCache(source);
    const cache = new MaterialCache(assets);
    const load = cache.acquire(RED);
    cache.release(RED);
    expect(await load.catch((error: unknown) => (error as Error).message)).toContain("released");
    expect(assets.keys()).toEqual([]);
  });
});

describe("the material asset of a shape", () => {
  it("draws with the material asset, changes it in place and releases it", async () => {
    const { assets, builder } = await builderWith({ shape: { kind: "sphere", material: RED } });
    const mesh = builder.componentObject("item", "shape") as Mesh;
    expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe("ff0000");
    await apply(builder, [{ op: "set", path: "/entities/item/components/shape/material", value: BLUE }]);
    expect(builder.componentObject("item", "shape")).toBe(mesh);
    expect(mesh.material).toBeInstanceOf(MeshPhongMaterial);
    expect(assets.released).toContain(`material|${RED}`);
    await apply(builder, [{ op: "set", path: "/entities/item/components/shape/material" }]);
    expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe("cccccc");
    expect(builder.assetUsers(BLUE, "material")).toBe(0);
  });
});

describe("the material overrides of a model", () => {
  const materials = {
    "mesh:seat": { material: RED },
    metal: { colour: "#00ff00" },
  };

  it("a mesh key covers the meshes under its node; a material key changes a copy", async () => {
    const { builder } = await builderWith({ model: { asset: CHAIR, materials } });
    const cushion = meshNamed(builder, "cushion").material as MeshStandardMaterial;
    expect(cushion.color.getHexString()).toBe("ff0000");
    expect(cushion.map).not.toBeNull();
    const leg = meshNamed(builder, "leg").material as MeshStandardMaterial;
    expect([leg.name, leg.color.getHexString()]).toEqual(["metal", "00ff00"]);
    expect(modelOverrideMaterials(builder.componentObject("item", "model")!)).toEqual([leg]);
  });

  it("a mesh key comes before a material key, and values change a copy of the material asset", async () => {
    const both = { "mesh:leg": { material: BLUE, colour: "#ffffff" }, metal: { colour: "#00ff00" } };
    const { builder } = await builderWith({ model: { asset: CHAIR, materials: both } });
    const leg = meshNamed(builder, "leg").material as MeshPhongMaterial;
    expect(leg).toBeInstanceOf(MeshPhongMaterial);
    expect([leg.color.getHexString(), leg.shininess]).toEqual(["ffffff", 50]);
  });

  it("a patch changes the same clone, disposes the old copies and releases the unused assets", async () => {
    const { assets, builder } = await builderWith({ model: { asset: CHAIR, materials } });
    const holder = builder.componentObject("item", "model")!;
    const instance = modelInstance(holder);
    const [oldCopy] = modelOverrideMaterials(holder) as Material[];
    let gone = false;
    oldCopy?.addEventListener("dispose", () => (gone = true));
    const path = "/entities/item/components/model/materials";
    await apply(builder, [{ op: "set", path: `${path}/metal/colour`, value: "#0000ff" }]);
    expect(modelInstance(holder)).toBe(instance);
    expect(gone).toBe(true);
    expect((meshNamed(builder, "leg").material as MeshStandardMaterial).color.getHexString()).toBe("0000ff");
    expect(builder.assetUsers(RED, "material")).toBe(1);
    expect(assets.loads.filter((load) => load.startsWith("model|"))).toHaveLength(1);
    await apply(builder, [{ op: "set", path }]);
    expect(modelInstance(holder)).toBe(instance);
    expect((meshNamed(builder, "cushion").material as Material).name).toBe("fabric");
    expect(builder.assetUsers(RED, "material")).toBe(0);
    expect(modelOverrideMaterials(holder)).toEqual([]);
  });

  it("a removed entity releases its material assets", async () => {
    const { builder } = await builderWith({ model: { asset: CHAIR, materials } });
    await apply(builder, [{ op: "remove", id: "item" }]);
    expect([builder.assetUsers(RED, "material"), builder.assetUsers(CHECKER, "texture")]).toEqual([0, 0]);
  });

  it("a material that does not load is a warning, and the part keeps its material", async () => {
    const missing = { "mesh:seat": { material: "asset:mat-none-00001" } };
    const { builder } = await builderWith({ model: { asset: CHAIR, materials: missing } });
    expect((meshNamed(builder, "cushion").material as Material).name).toBe("fabric");
    expect(builder.warnings().join("\n")).toContain('the material "asset:mat-none-00001" did not load');
  });
});
