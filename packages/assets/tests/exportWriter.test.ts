// SPDX-License-Identifier: Apache-2.0
// The glTF writer of a scene document: the shape meshes (size, faces that point out), a hidden entity, a spot
// light that points at an entity, the light kinds with no glTF form, a model with no file, and the world transform
// under a turned and scaled parent.
import { describe, expect, test } from "bun:test";
import { getBounds } from "@gltf-transform/core";
import type { Light, Visibility } from "@gltf-transform/extensions";
import { canonicalJson, readDocument, worldTransform, type SceneDocument } from "@scenity/scene";
import { ModelFiles } from "../src/export/models";
import { shapeGeometry } from "../src/export/shapes";
import { sceneGlb, writeSceneGltf } from "../src/export/writer";
import { direction, dot, expectEntityMatrix, forwardOf, nodeNamed, readGlb } from "./exportHelpers";

function sceneOf(entities: Record<string, unknown>): SceneDocument {
  const read = readDocument(canonicalJson({ entities, format: "scenity.scene/1", id: "test" }), "scene");
  if (!read.ok) throw new Error(read.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  return read.doc;
}

const NO_FILES = new ModelFiles(() => Promise.resolve(null));

const SCENE = sceneOf({
  crate: {
    components: {
      shape: { kind: "box", size: [1, 2, 3], colour: "#ff0000" },
      transform: { position: [2, 1, -1], rotation: [0, 0.382683, 0, 0.92388], scale: [2, 2, 2] },
    },
    index: 0,
    parent: null,
  },
  lid: { components: { transform: { position: [0.1, 1, 0.2] } }, index: 0, parent: "crate" },
  ball: { components: { shape: { kind: "sphere", size: [1, 2, 1] } }, index: 1, parent: null },
  pad: { components: { shape: { kind: "plane", size: [2, 0, 4] } }, index: 2, parent: null },
  hidden: { components: { visibility: { visible: false } }, index: 3, parent: null },
  spot: {
    components: {
      light: { type: "spot", angle: 0.5, penumbra: 0.5, target: "entity:lid" },
      transform: { position: [-1, 3, 2] },
    },
    index: 4,
    parent: null,
  },
  glow: { components: { light: { type: "ambient", intensity: 0.3 } }, index: 5, parent: null },
  chair: { components: { model: { asset: "asset:01J9Z6Q3R9NOFILE00000000A" } }, index: 6, parent: null },
});

describe("the shape geometry", () => {
  test("each triangle faces out, and the normals point out", () => {
    for (const kind of ["box", "plane", "cylinder", "sphere"] as const) {
      const geometry = shapeGeometry(kind, [1, 2, 1]);
      const at = (index: number, data: number[]) => [0, 1, 2].map((axis) => data[index * 3 + axis]!);
      for (let i = 0; i < geometry.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => at(geometry.indices[i + k]!, geometry.positions));
        const e1 = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
        const e2 = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
        const face = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const normal = at(geometry.indices[i]!, geometry.normals);
        // The sphere has no triangle with a zero area: the writer leaves them out at the poles, as three.js does.
        expect({ kind, i, out: dot(face, normal) > 0 }).toEqual({ kind, i, out: true });
      }
    }
  });
});

describe("the writer", () => {
  test("the shapes have the size of the document", async () => {
    const doc = await readGlb(await sceneGlb(await writeSceneGltf(SCENE, NO_FILES)));
    const round = (values: number[]) => values.map((value) => Math.round(value * 1e5) / 1e5 + 0);
    expect(round(getBounds(nodeNamed(doc, "ball:shape")).max)).toEqual([0.5, 1, 0.5]);
    expect(round(getBounds(nodeNamed(doc, "pad:shape")).min)).toEqual([-1, 0, -2]);
    const box = nodeNamed(doc, "crate:shape").getMesh()!.listPrimitives()[0]!;
    expect(round(box.getAttribute("POSITION")!.getMax([0, 0, 0]))).toEqual([0.5, 1, 1.5]);
    expect(round(box.getMaterial()!.getBaseColorFactor())).toEqual([1, 0, 0, 1]);
  });

  test("a parent with a turn and a scale gives the world transform of the document", async () => {
    const doc = await readGlb(await sceneGlb(await writeSceneGltf(SCENE, NO_FILES)));
    for (const id of Object.keys(SCENE.entities)) expectEntityMatrix(SCENE, nodeNamed(doc, id), id);
  });

  test("a hidden entity has KHR_node_visibility; a spot light points at its target entity", async () => {
    const written = await writeSceneGltf(SCENE, NO_FILES);
    const doc = await readGlb(await sceneGlb(written));
    expect(nodeNamed(doc, "hidden").getExtension<Visibility>("KHR_node_visibility")?.getVisible()).toBe(false);
    expect(nodeNamed(doc, "crate").getExtension("KHR_node_visibility")).toBeNull();
    const node = nodeNamed(doc, "spot:light");
    const light = node.getExtension<Light>("KHR_lights_punctual")!;
    expect([light.getType(), light.getOuterConeAngle(), light.getInnerConeAngle()]).toEqual(["spot", 0.5, 0.25]);
    const lid = worldTransform(SCENE, "lid")!.position;
    expect(dot(forwardOf(node), direction(node.getWorldTranslation(), lid))).toBeGreaterThan(1 - 1e-9);
  });

  test("an ambient light and a model with no file give warnings", async () => {
    const written = await writeSceneGltf(SCENE, NO_FILES);
    expect(written.warnings).toEqual([
      "glow: glTF has no ambient light; the node keeps its values in extras.light",
      "chair: the model asset:01J9Z6Q3R9NOFILE00000000A has no glTF file; the export skips it",
    ]);
    expect(written.models).toEqual({});
  });

  test("a scene with no light and no hidden entity names no extension", async () => {
    const plain = sceneOf({ pad: { components: { shape: { kind: "plane" } }, index: 0, parent: null } });
    const doc = await readGlb(await sceneGlb(await writeSceneGltf(plain, NO_FILES)));
    expect(doc.getRoot().listExtensionsUsed()).toEqual([]);
  });
});
