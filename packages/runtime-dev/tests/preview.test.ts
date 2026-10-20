// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import type { ExtensionMessage } from "@scenity/runtime/protocol";
import { Box3, type Mesh, type MeshStandardMaterial } from "three";
import type { DevCoreApi } from "../src/client";
import { hideLayers, PREVIEW_ROOT, PreviewLayer, type PreviewModel } from "../src/preview";
import { handleDevMessage } from "../src/worker/extension";

// The import previews of the lab: plain meshes at the drop point, hidden in the pictures of the core (they are not an
// input of the frame key).

/** A 0.2 m triangle pair with its base on y = 0 around the origin of the model. */
function model(id: string, at: [number, number, number]): PreviewModel {
  return {
    id,
    name: `${id}.obj`,
    at,
    yaw: 0,
    meshes: [
      {
        positions: new Float32Array([-0.1, 0, 0, 0.1, 0, 0, 0.1, 0.2, 0, -0.1, 0.2, 0]),
        normals: null,
        uvs: null,
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        color: [0.5, 0.25, 1],
        opacity: 1,
        texture: null,
      },
    ],
  };
}

describe("PreviewLayer", () => {
  it("puts the base centre of each model at its drop point", () => {
    const layer = new PreviewLayer();
    expect(layer.root.name).toBe(PREVIEW_ROOT);
    expect(layer.root.visible).toBe(false);
    layer.set([model("a", [1, 0, -0.5]), model("b", [0, 0.9, 0])]);
    expect(layer.size).toBe(2);
    expect(layer.root.visible).toBe(true);
    layer.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(layer.root.children[0] ?? layer.root);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(1, 6);
    expect(box.min.z).toBeCloseTo(-0.5, 6);
    const mesh = layer.root.children[0]?.children[0] as Mesh;
    expect(mesh.geometry.getAttribute("normal")).toBeDefined();
    expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe("8040ff");
  });

  it("replaces the models and is empty after an empty list", () => {
    const layer = new PreviewLayer();
    layer.set([model("a", [0, 0, 0])]);
    layer.set([model("b", [0, 0, 0])]);
    expect(layer.root.children.map((group) => group.name)).toEqual(["preview:b"]);
    layer.set([]);
    expect(layer.size).toBe(0);
    expect(layer.root.visible).toBe(false);
  });

  it("hides the visible layers for a picture and shows them again", () => {
    const layer = new PreviewLayer();
    const empty = new PreviewLayer();
    layer.set([model("a", [0, 0, 0])]);
    const showAgain = hideLayers([layer, empty, null]);
    expect(layer.root.visible).toBe(false);
    showAgain?.();
    expect(layer.root.visible).toBe(true);
    expect(hideLayers([empty, null])).toBeNull();
  });
});

describe("the previews message of the labs worker", () => {
  it("gives the models to the core", () => {
    const seen: (readonly PreviewModel[])[] = [];
    const core = { setPreviews: (models: readonly PreviewModel[]) => seen.push(models) } as unknown as DevCoreApi;
    const posted: ExtensionMessage[] = [];
    const models = [model("a", [0, 0, 0])];
    handleDevMessage({ type: "previews", models }, core, (message) => posted.push(message));
    expect(seen).toEqual([models]);
    expect(posted).toEqual([]);
  });
});
