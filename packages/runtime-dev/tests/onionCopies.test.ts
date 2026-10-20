// SPDX-License-Identifier: Apache-2.0
// The onion skins of the Scene view: a copy of each visible mesh of an entity at each world matrix of the page, with
// the tone of its side of the clock time. The pick ignores the copies. A spec with no copies removes them.
import { describe, expect, test } from "bun:test";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from "three";
import { OnionCopies, plainOnion } from "../src/document/onionCopies";

/** A scene with an entity of two meshes (one of them under a child, one hidden). */
function sceneOf() {
  const scene = new Scene();
  const entity = new Group();
  const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const child = new Group();
  child.position.set(0, 1, 0);
  const top = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial());
  const hidden = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  hidden.visible = false;
  child.add(top);
  entity.add(box, child, hidden);
  scene.add(entity);
  return { scene, entity };
}

const at = (x: number): number[] => new Matrix4().makeTranslation(x, 0, 0).toArray();

describe("the onion skins of an entity", () => {
  test("copies each visible mesh at each matrix, with the tone and the opacity of the copy", () => {
    const { scene, entity } = sceneOf();
    const onion = new OnionCopies();
    const spec = {
      entity: "lamp",
      copies: [
        { matrix: at(-2), side: "before" as const, opacity: 0.5 },
        { matrix: at(3), side: "after" as const, opacity: 0.38 },
      ],
    };
    onion.set(plainOnion(spec));
    onion.apply(scene, (id) => (id === "lamp" ? entity : undefined));
    expect(onion.count).toBe(4);
    const places = onion.group.children.map((child) =>
      new Vector3().setFromMatrixPosition(child.matrixWorld).toArray(),
    );
    expect(places).toEqual([
      [-2, 0, 0],
      [-2, 1, 0],
      [3, 0, 0],
      [3, 1, 0],
    ]);
    const first = onion.group.children[0] as Mesh;
    expect((first.material as MeshBasicMaterial).opacity).toBe(0.5);
    expect((first.material as MeshBasicMaterial).color.getHex()).toBe(0x4f9dff);
    // The pick of the scene ignores the copies.
    const ray = new Raycaster(new Vector3(-2, 0, 5), new Vector3(0, 0, -1));
    expect(ray.intersectObject(onion.group, true)).toEqual([]);
    onion.set({ entity: "lamp", copies: [] });
    onion.apply(scene, () => entity);
    expect(onion.count).toBe(0);
  });

  test("an entity that the scene does not have gives no copies", () => {
    const { scene } = sceneOf();
    const onion = new OnionCopies();
    onion.set({ entity: "missing", copies: [{ matrix: at(1), side: "after", opacity: 0.5 }] });
    onion.apply(scene, () => undefined);
    expect(onion.count).toBe(0);
  });
});
