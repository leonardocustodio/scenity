// SPDX-License-Identifier: Apache-2.0
// The ghosts of the changes that wait: a faint copy of each visible mesh of each entity at its new place, in the
// colour of its session. The pick ignores the ghosts. An entity with no object has no ghost. A spec with no copies
// removes them.
import { describe, expect, test } from "bun:test";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector3 } from "three";
import { GhostCopies, plainGhosts } from "../src/document/ghostCopies";

function entityOf(scene: Scene): Group {
  const entity = new Group();
  const child = new Group();
  child.position.set(0, 1, 0);
  child.add(new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial()));
  entity.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()), child);
  scene.add(entity);
  return entity;
}

const at = (x: number): number[] => new Matrix4().makeTranslation(x, 0, 0).toArray();

describe("the ghosts of the changes that wait", () => {
  test("copy each visible mesh of each entity at its new place, in the colour of its session", () => {
    const scene = new Scene();
    const objects: Record<string, Group> = { chair: entityOf(scene), lamp: entityOf(scene) };
    const ghosts = new GhostCopies();
    ghosts.set(
      plainGhosts({
        copies: [
          { entity: "chair", matrix: at(2), colour: "#7c3aed" },
          { entity: "lamp", matrix: at(-3), colour: "#0ea5e9" },
          { entity: "gone", matrix: at(9), colour: "#000000" },
        ],
      }),
    );
    ghosts.apply(scene, (id) => objects[id]);
    expect(ghosts.count).toBe(4);
    const places = ghosts.group.children.map((child) =>
      new Vector3().setFromMatrixPosition(child.matrixWorld).toArray(),
    );
    expect(places).toEqual([
      [2, 0, 0],
      [2, 1, 0],
      [-3, 0, 0],
      [-3, 1, 0],
    ]);
    const first = (ghosts.group.children[0] as Mesh).material as MeshBasicMaterial;
    expect(first.color.getHexString()).toBe("7c3aed");
    expect(first.transparent).toBe(true);
    const ray = new Raycaster(new Vector3(2, 0, 5), new Vector3(0, 0, -1));
    expect(ray.intersectObject(ghosts.group, true)).toEqual([]);
    ghosts.set({ copies: [] });
    ghosts.apply(scene, (id) => objects[id]);
    expect(ghosts.count).toBe(0);
  });
});
