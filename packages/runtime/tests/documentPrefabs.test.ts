// SPDX-License-Identifier: Apache-2.0
// The prefab instances of the document core. With the prefabs of a "load", the core draws and picks the expanded
// scene. A patch is ops on the scene before the expansion: a change of the overrides
// of one instance changes only its entities. A "load" with only `prefabs` expands the same base again, so each
// instance shows the new prefab. A core with no prefab set keeps the plain builder path.
import { describe, expect, it } from "bun:test";
import type { Object3D } from "three";
import type { RenderBackend, RenderBackendFactory, SceneRenderer } from "@scenity/render/types";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import { DocumentCore } from "../src/core/documentCore";
import { DocumentPrefabs } from "../src/core/documentPrefabs";
import { builtinRegistry } from "@scenity/scene/components";
import { FakeAssets, showroom } from "./sceneHelpers";

const STOOL = "scenes/stool.prefab.json";

const prefab: PrefabDocument = {
  format: "scenity.prefab/1",
  id: "stool",
  root: "base",
  entities: {
    base: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
    seat: { parent: "base", index: 0, components: { transform: { position: [0, 0.4, 0] } } },
  },
};

/** The showroom with two stool instances. The first one moves its seat up. */
function room(): SceneDocument {
  const scene = showroom();
  const instance = (x: number, index: number, overrides: unknown[]) => ({
    parent: null,
    index,
    components: { transform: { position: [x, 0, 1.6] }, prefab: { source: "stool.prefab.json", overrides } },
  });
  const roots = Object.values(scene.entities).filter((entity) => entity.parent === null).length;
  const up = [{ op: "set" as const, path: "/entities/seat/components/transform/position/1", value: 0.6 }];
  const doc: SceneDocument = {
    ...scene,
    entities: { ...scene.entities, "stool-a": instance(1, roots, up), "stool-b": instance(2, roots + 1, []) },
  };
  return doc;
}

/** A backend with no GPU that keeps the last scene it draws. */
function fakeBackend(last: { scene: Object3D | null }): RenderBackendFactory {
  return () => {
    const renderer = {
      domElement: {} as OffscreenCanvas,
      shadowMap: { enabled: false, type: 1 },
      setPixelRatio: () => undefined,
      setSize: () => undefined,
      getSize: (target) => target,
      render: () => undefined,
      getPixelRatio: () => 1,
      setViewport: () => undefined,
      setScissor: () => undefined,
      setScissorTest: () => undefined,
    } as SceneRenderer;
    const backend: RenderBackend = {
      kind: "webgl",
      renderer,
      isReady: () => true,
      ready: Promise.resolve(),
      render: (scene) => {
        last.scene = scene;
      },
      info: () => ({ calls: 0, triangles: 0 }),
      memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
      timer: () => null,
      textureSupport: () => ({ gpuFeatures: { has: () => false } }),
      dispose: () => undefined,
    };
    return backend;
  };
}

function core(): DocumentCore {
  const last = { scene: null as Object3D | null };
  return new DocumentCore({
    canvas: {} as OffscreenCanvas,
    surface: { width: 320, height: 200, dpr: 1 },
    tier: "high",
    flags: { reducedMotion: false, paused: false, visible: true },
    clock: () => null,
    now: () => performance.now(),
    scheduler: {
      request: (callback) => setTimeout(callback, 0) as unknown as number,
      cancel: (handle) => {
        clearTimeout(handle);
      },
    },
    mode: "main",
    events: { ready: () => undefined, anchors: () => undefined, hit: () => undefined, context: () => undefined },
    backend: fakeBackend(last),
    assetSource: () => new FakeAssets(),
  });
}

/** The world height of an entity object of the core. */
function worldY(target: DocumentCore, id: string): number | undefined {
  const object = target.builder.entityObject(id);
  object?.updateWorldMatrix(true, false);
  return object?.matrixWorld.elements[13];
}

describe("the prefab instances of the document core", () => {
  it("draws the expanded scene, patches the base and expands a new prefab set again", async () => {
    const target = core();
    target.start();
    const prefabs = { path: "scenes/main.scene.json", set: { [STOOL]: prefab } };
    const loaded = await target.load({ documents: { scene: room(), prefabs } });
    expect(loaded.ok).toBe(true);
    expect(target.builder.entityIds()).toContain("stool-b/seat");
    expect(worldY(target, "stool-a/seat")).toBeCloseTo(0.6, 6);
    expect(worldY(target, "stool-b/seat")).toBeCloseTo(0.4, 6);
    // A patch on the base removes the override of stool A. Only its seat returns to its place.
    const path = "/entities/stool-a/components/prefab/overrides";
    expect(await target.patch([{ op: "set", path }])).toEqual({ ok: true, warnings: [] });
    expect(worldY(target, "stool-a/seat")).toBeCloseTo(0.4, 6);
    // A bad op changes nothing.
    expect((await target.patch([{ op: "remove", id: "stool-a/seat" }])).ok).toBe(false);
    // A new prefab set: each instance shows it.
    const seat = { ...prefab.entities.seat!, components: { transform: { position: [0, 0.5, 0] } } };
    const changed = { ...prefab, entities: { ...prefab.entities, seat } };
    await target.load({ prefabs: { ...prefabs, set: { [STOOL]: changed } } });
    expect(worldY(target, "stool-a/seat")).toBeCloseTo(0.5, 6);
    expect(worldY(target, "stool-b/seat")).toBeCloseTo(0.5, 6);
    // A plain patch of an entity of the base still applies after the expansion.
    await target.patch([{ op: "set", path: "/entities/stool-b/components/transform/position/1", value: 1 }]);
    expect(worldY(target, "stool-b/seat")).toBeCloseTo(1.5, 6);
    target.dispose();
  });

  it("keeps the builder path with no prefab set", () => {
    const prefabs = new DocumentPrefabs(() => builtinRegistry());
    const scene = room();
    expect(prefabs.load(scene, undefined)).toBe(scene);
    expect(prefabs.patch([], scene, () => undefined)).toBeNull();
    const plain = showroom();
    const set = { path: "scenes/main.scene.json", set: { [STOOL]: prefab } };
    expect(prefabs.load(plain, set)).toBe(plain);
  });
});
