// SPDX-License-Identifier: Apache-2.0
// The glTF export of a scene of a project: the showroom read back with glTF Transform (the node of each
// entity, its world transform, its extras, the meshes of each model, the lights and the cameras), the prefabs, the
// same bytes from two exports, and the `export` command of the CLI.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Document, Node } from "@gltf-transform/core";
import type { Light } from "@gltf-transform/extensions";
import { canonicalJson, parseRef, readDocument, type SceneDocument } from "@scenity/scene";
import { modelInput } from "../src/build/projectInputs";
import { runCli } from "../src/cli";
import { AssetDatabase } from "../src/database";
import { exportScene, type SceneExport } from "../src/export/project";
import { defaultImporterRegistry } from "../src/import/run";
import { direction, dot, expectEntityMatrix, forwardOf, nodeNamed, readGlb } from "./exportHelpers";
import { copyShowroom, put, removeTemps, SHOWROOM, tempDir } from "./helpers";

let result: SceneExport;
let gltf: Document;
let scene: SceneDocument;

beforeAll(async () => {
  result = await exportScene(SHOWROOM, "main", { runImports: false });
  gltf = await readGlb(result.glb);
  const read = readDocument(readFileSync(join(SHOWROOM, "scenes/main.scene.json"), "utf8"), "scene");
  if (!read.ok) throw new Error("the showroom scene does not read");
  scene = read.doc;
});
afterAll(removeTemps);

/** The mesh names, primitive counts and vertex counts under a node. */
function meshesUnder(nodes: readonly Node[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    node.traverse((child) => {
      const mesh = child.getMesh();
      if (mesh === null) return;
      const vertices = mesh.listPrimitives().map((primitive) => primitive.getAttribute("POSITION")?.getCount() ?? 0);
      out.push(`${mesh.getName()} ${vertices.join("+")}`);
    });
  }
  return out.sort();
}

describe("the glTF export of the showroom", () => {
  test("each entity is one node with its ID as the name, its extras and its parent", () => {
    for (const [id, entity] of Object.entries(scene.entities)) {
      const node = nodeNamed(gltf, id);
      expect(node.getExtras()).toEqual({
        entity: id,
        name: entity.name!,
        tags: [...(entity.tags ?? [])],
        components: Object.keys(entity.components).sort(),
      });
      const parent = node.getParentNode();
      expect(parent?.getName() ?? null).toBe(entity.parent);
    }
    const roots = gltf.getRoot().getDefaultScene()!.listChildren();
    expect(roots.map((node) => node.getName())).toEqual(
      Object.keys(scene.entities)
        .filter((id) => scene.entities[id]!.parent === null)
        .sort((a, b) => scene.entities[a]!.index - scene.entities[b]!.index),
    );
  });

  test("the world transform of each entity is the world transform of the document (1e-5)", () => {
    for (const id of Object.keys(scene.entities)) expectEntityMatrix(scene, nodeNamed(gltf, id), id);
  });

  test("each model has each mesh of its model file, with the same vertex counts", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const options = { registry: defaultImporterRegistry(), runImports: false };
    const models = Object.entries(scene.entities).filter(([, entity]) => entity.components.model !== undefined);
    expect(models.length).toBe(6);
    for (const [id, entity] of models) {
      const asset = parseRef((entity.components.model as { asset: string }).asset);
      const bytes = await modelInput(SHOWROOM, db.get(asset?.kind === "asset" ? asset.id : "")!, options, []);
      const source = await readGlb(bytes!);
      const expected = meshesUnder(source.getRoot().getDefaultScene()!.listChildren());
      expect(expected.length).toBeGreaterThan(0);
      expect(meshesUnder(nodeNamed(gltf, `${id}:model`).listChildren())).toEqual(expected);
      expect([...(result.models[id] ?? [])].sort()).toEqual(expected.map((line) => line.split(" ")[0]!));
    }
    expect(
      gltf
        .getRoot()
        .listTextures()
        .every((texture) => texture.getMimeType() === "image/jpeg"),
    ).toBe(true);
  });

  test("the lights are KHR_lights_punctual; the hemisphere light keeps its values in extras", () => {
    const sun = nodeNamed(gltf, "sun:light").getExtension<Light>("KHR_lights_punctual")!;
    expect([sun.getType(), sun.getIntensity()]).toEqual(["directional", 2.2]);
    // The sun has no target: it points along -Z of its entity.
    expect(nodeNamed(gltf, "sun:light").getRotation()).toEqual([0, 0, 0, 1]);
    const lantern = nodeNamed(gltf, "lantern-light:light").getExtension<Light>("KHR_lights_punctual")!;
    expect([lantern.getType(), lantern.getIntensity(), lantern.getRange()]).toEqual(["point", 1.5, 4]);
    // [255, 214, 160] in sRGB as linear parts.
    expect(lantern.getColor().map((part) => Math.round(part * 1000) / 1000)).toEqual([1, 0.672, 0.352]);
    const fill = nodeNamed(gltf, "fill:light");
    expect(fill.getExtension("KHR_lights_punctual")).toBeNull();
    expect((fill.getExtras().light as { type: string }).type).toBe("hemisphere");
    expect(result.warnings).toEqual(["fill: glTF has no hemisphere light; the node keeps its values in extras.light"]);
  });

  test("the cameras have the field of view of the document and look at their targets", () => {
    for (const id of ["front", "top"]) {
      const node = nodeNamed(gltf, `${id}:camera`);
      const value = scene.entities[id]!.components.camera as { fov: number; target: number[] };
      expect(node.getCamera()!.getYFov()).toBeCloseTo((value.fov * Math.PI) / 180, 9);
      const eye = node.getWorldTranslation();
      expect(dot(forwardOf(node), direction(eye, value.target))).toBeGreaterThan(1 - 1e-9);
    }
  });

  test("the socket is an empty node at its place", () => {
    const top = nodeNamed(gltf, "table#top");
    expect(top.getTranslation()).toEqual([0, 0.549, 0]);
    expect(top.getParentNode()?.getName()).toBe("table");
  });

  test("two exports give the same bytes", async () => {
    const again = await exportScene(SHOWROOM, "main", { runImports: false });
    expect(Buffer.from(again.glb).equals(Buffer.from(result.glb))).toBe(true);
  });
});

describe("the export of a project", () => {
  test("a prefab instance expands into nodes <instance>/<entity>", async () => {
    const dir = copyShowroom();
    const prefab = {
      entities: {
        base: { components: { shape: { kind: "cylinder", size: [0.2, 0.05, 0.2] } }, index: 0, parent: null },
        bulb: {
          components: { light: { type: "spot", angle: 0.5 }, transform: { position: [0, 0.4, 0] } },
          index: 0,
          parent: "base",
        },
      },
      format: "scenity.prefab/1",
      id: "lamp",
      root: "base",
    };
    put(dir, "prefabs/lamp.prefab.json", canonicalJson(prefab));
    const path = join(dir, "scenes/main.scene.json");
    const doc = JSON.parse(readFileSync(path, "utf8")) as { entities: Record<string, unknown> };
    doc.entities.lamp = {
      components: { prefab: { source: "../prefabs/lamp.prefab.json" }, transform: { position: [1, 0, 1] } },
      index: 12,
      parent: null,
    };
    put(dir, "scenes/main.scene.json", canonicalJson(doc));
    const exported = await exportScene(dir, "scenes/main.scene.json", { runImports: false });
    const read = await readGlb(exported.glb);
    expect(nodeNamed(read, "lamp/bulb").getParentNode()?.getName()).toBe("lamp/base");
    expect(nodeNamed(read, "lamp/bulb").getWorldTranslation()).toEqual([1, 0.4, 1]);
    expect(nodeNamed(read, "lamp/bulb:light").getExtension<Light>("KHR_lights_punctual")?.getType()).toBe("spot");
    expect(nodeNamed(read, "lamp/base:shape").getMesh()).not.toBeNull();
  });

  test("the CLI writes the GLB file; an unknown scene exits with 2", async () => {
    const out = join(tempDir(), "out", "showroom.glb");
    const done = await runCli(["export", SHOWROOM, "main", "--out", out, "--no-import"]);
    expect(done.code).toBe(0);
    expect(done.out.at(-1)).toContain("14 entities, 6 models");
    expect(existsSync(out)).toBe(true);
    const missing = await runCli(["export", SHOWROOM, "nowhere", "--no-import"]);
    expect(missing).toEqual({ out: ['the project has no scene "nowhere" (scenes: main)'], code: 2 });
    expect((await runCli(["export", SHOWROOM])).code).toBe(2);
  });
});
