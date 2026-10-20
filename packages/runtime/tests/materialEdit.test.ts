// SPDX-License-Identifier: Apache-2.0
// The edits of the material editor: `SceneBuilder.editMaterials` puts an edited document in place of the document of
// a material asset. The shared material of the asset changes in place for each user (a shape and a model part with a
// value copy). A new type gives a new material to each user. A texture copy with the same form stays. A later load of
// the asset uses the edited document.
import { describe, expect, it } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial, Texture, type Material } from "three";
import type { MaterialDocument, SceneDocument } from "@scenity/scene";
import { modelInstance, SceneBuilder, type AssetKind, type AssetSource, type AssetValue } from "../src";
import { updateMaterial } from "../src/scene/materialUpdate";

const STEEL = "asset:mat-steel-00001";
const CHECKER = "asset:tex-checker-01";
const CHAIR = "asset:model-chair-01";

const STEEL_DOC: MaterialDocument = {
  format: "scenity.material/1",
  type: "standard",
  colour: "#808080",
  roughness: 0.5,
  maps: { colour: { texture: CHECKER } },
};

/** A fake source: one material document, a texture and a chair with a cushion and a leg. */
class Assets implements AssetSource {
  readonly loads: string[] = [];

  load(ref: string, kind: AssetKind): Promise<AssetValue> {
    this.loads.push(`${kind}|${ref}`);
    if (kind === "material") return Promise.resolve({ material: STEEL_DOC });
    if (kind === "texture") return Promise.resolve(new Texture());
    const chair = new Group();
    const cushion = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: "fabric" }));
    cushion.name = "cushion";
    const leg = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: "metal" }));
    leg.name = "leg";
    chair.add(cushion, leg);
    return Promise.resolve(chair);
  }
}

/** A sphere with the steel material and a chair whose leg takes the steel with a value copy. */
const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "main",
  entities: {
    ball: { parent: null, index: 0, components: { shape: { kind: "sphere", material: STEEL } } },
    chair: {
      parent: null,
      index: 1,
      components: {
        model: {
          asset: CHAIR,
          materials: { "mesh:leg": { material: STEEL, opacity: 0.5 }, fabric: { material: STEEL } },
        },
      },
    },
  },
};

async function built() {
  const assets = new Assets();
  const builder = new SceneBuilder({ assets });
  builder.build(SCENE);
  await builder.ready();
  const ball = builder.componentObject("ball", "shape") as Mesh;
  const chair = modelInstance(builder.componentObject("chair", "model")!)!;
  const part = (name: string) => (chair.getObjectByName(name) as Mesh).material as Material;
  return { assets, builder, ball, part };
}

async function edit(builder: SceneBuilder, doc: Partial<MaterialDocument>): Promise<void> {
  const next: MaterialDocument = { ...STEEL_DOC, ...doc };
  builder.editMaterials({ [STEEL]: next });
  await builder.ready();
}

describe("the edits of the material editor", () => {
  it("changes the shared material in place for each user of the asset", async () => {
    const { builder, ball, part } = await built();
    const shared = ball.material as MeshStandardMaterial;
    expect(part("cushion")).toBe(shared);
    const map = shared.map;
    await edit(builder, { colour: "#ff0000", roughness: 0.2 });
    expect(ball.material).toBe(shared);
    expect([shared.color.getHexString(), shared.roughness]).toEqual(["ff0000", 0.2]);
    // The texture copy has the same form: it stays.
    expect(shared.map).toBe(map);
    expect(part("cushion")).toBe(shared);
    // The leg has a copy with the opacity of its override: the copy also gets the new values.
    const leg = part("leg") as MeshStandardMaterial;
    expect(leg).not.toBe(shared);
    expect([leg.color.getHexString(), leg.roughness, leg.opacity]).toEqual(["ff0000", 0.2, 0.5]);
  });

  it("gives a new material to each user for a new type", async () => {
    const { builder, ball, part } = await built();
    const old = ball.material;
    let disposed = false;
    (old as Material).addEventListener("dispose", () => {
      disposed = true;
    });
    await edit(builder, { type: "phong", colour: "#00ff00", roughness: undefined, shininess: 80 });
    expect(ball.material).toBeInstanceOf(MeshPhongMaterial);
    expect((ball.material as MeshPhongMaterial).shininess).toBe(80);
    expect(part("cushion")).toBe(ball.material as Material);
    expect(part("leg")).toBeInstanceOf(MeshPhongMaterial);
    expect(disposed).toBe(true);
  });

  it("drops a texture slot, and a later load of the asset uses the edited document", async () => {
    const { assets, builder, ball } = await built();
    await edit(builder, { maps: undefined, metalness: 1 });
    const shared = ball.material as MeshStandardMaterial;
    expect([shared.map, shared.metalness]).toEqual([null, 1]);
    // All users stop, then a new user makes the material again: it gets the edited values with no load of the file.
    builder.build({ ...SCENE, entities: {} });
    await builder.ready();
    builder.build(SCENE);
    await builder.ready();
    const again = builder.componentObject("ball", "shape") as Mesh;
    expect(assets.loads.filter((load) => load === `material|${STEEL}`)).toHaveLength(1);
    expect((again.material as MeshStandardMaterial).metalness).toBe(1);
  });

  it("an edit of an asset that no entity uses goes into the next user, with no load of the file", async () => {
    const assets = new Assets();
    const builder = new SceneBuilder({ assets });
    builder.editMaterials({ [STEEL]: { ...STEEL_DOC, colour: "#0000ff" } });
    await builder.ready();
    builder.build(SCENE);
    await builder.ready();
    const ball = builder.componentObject("ball", "shape") as Mesh;
    expect((ball.material as MeshStandardMaterial).color.getHexString()).toBe("0000ff");
    // A new material asset of the editor has no record in the manifest yet: the edit is sufficient.
    expect(assets.loads).not.toContain(`material|${STEEL}`);
  });
});

describe("updateMaterial", () => {
  it("compiles the material again only for a change of its program", () => {
    const target = new MeshStandardMaterial({ roughness: 0.5 });
    const before = target.version;
    updateMaterial(target, new MeshStandardMaterial({ roughness: 0.1 }));
    expect([target.roughness, target.version]).toEqual([0.1, before]);
    updateMaterial(target, new MeshStandardMaterial({ transparent: true, opacity: 0.5 }));
    expect(target.version).toBe(before + 1);
    expect(() => updateMaterial(target, new MeshPhongMaterial())).toThrow("cannot take");
  });
});
