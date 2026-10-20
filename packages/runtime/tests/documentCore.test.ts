// SPDX-License-Identifier: Apache-2.0
// The document core: "load" and "patch" control the scene builder in a scene core, and the answer comes after the
// frame that shows the change. The pick gives the entity, the component and the sub-target. The worker handler gives
// the same frame as the core on the main thread. Three.js runs with no
// renderer: a fake backend records the camera and the world places of each frame.
import { describe, expect, it } from "bun:test";
import { Matrix4, Texture, type Camera, type Object3D } from "three";
import type { RenderBackend, RenderBackendFactory, SceneRenderer, TextureSupport } from "@scenity/render/types";
import { DocumentCore } from "../src/core/documentCore";
import type { FromWorker, SceneCoreOptions, ToWorker } from "../src/protocol";
import { PROTOCOL_VERSION } from "../src/protocol";
import { ManifestAssets, recordFile } from "../src/scene/manifestAssets";
import { documentWorkerFactory } from "../src/worker/documentMessages";
import { attachSceneWorker } from "../src/worker/handler";
import { FakeAssets, manifestOf, modelRecord, showroom } from "./sceneHelpers";

const TABLE_ASSET = "asset:01M4ZPXYG50NAV41FPDE38QB7E";
const SURFACE = { width: 640, height: 400, dpr: 1 } as const;

/** One frame of the fake backend: the camera name and matrices, and the world matrix of each entity. */
interface Frame {
  readonly camera: string;
  readonly view: number[];
  readonly projection: number[];
  readonly entities: Readonly<Record<string, number[]>>;
}

function frameOf(scene: Object3D, camera: Camera): Frame {
  scene.updateMatrixWorld(true);
  const entities: Record<string, number[]> = {};
  scene.traverse((node) => {
    const id: unknown = node.userData.entity;
    if (typeof id === "string") entities[id] = [...node.matrixWorld.elements];
  });
  camera.updateMatrixWorld(true);
  return {
    camera: camera.parent?.name ?? camera.name,
    view: [...new Matrix4().copy(camera.matrixWorldInverse).elements],
    projection: [...camera.projectionMatrix.elements],
    entities,
  };
}

/** A backend with no GPU: it records each frame. */
function fakeBackend(frames: Frame[]): RenderBackendFactory {
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
      render: (scene, camera) => {
        frames.push(frameOf(scene, camera));
      },
      info: () => ({ calls: frames.length, triangles: 0 }),
      memory: () => ({ geometries: 1, textures: 2, programs: 3 }),
      timer: () => null,
      textureSupport: () => ({ gpuFeatures: { has: () => false } }),
      dispose: () => undefined,
    };
    return backend;
  };
}

/** The options of a core with a timer scheduler and no clock. */
function baseOptions(frames: Frame[], mode: "worker" | "main"): SceneCoreOptions {
  return {
    canvas: {} as OffscreenCanvas,
    surface: SURFACE,
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
    mode,
    events: { ready: () => undefined, anchors: () => undefined, hit: () => undefined, context: () => undefined },
    backend: fakeBackend(frames),
  };
}

/** A PMREM maker with no renderer. */
const FAKE_MAPS = () => ({
  fromEquirectangular: () => new Texture(),
  fromCubemap: () => new Texture(),
  dispose: () => undefined,
});

function documentCore(frames: Frame[], assets: FakeAssets, mode: "worker" | "main" = "main"): DocumentCore {
  return new DocumentCore({
    ...baseOptions(frames, mode),
    assetSource: () => assets,
    environmentMaps: FAKE_MAPS,
  });
}

const MANIFEST = manifestOf([modelRecord("01M4ZPXYG50NAV41FPDE38QB7E", ["table.glb"])]);

describe("the document core", () => {
  it("loads a scene document and answers after the frame that shows each asset", async () => {
    const frames: Frame[] = [];
    const assets = new FakeAssets();
    const core = documentCore(frames, assets);
    core.start();
    expect(core.stats(false).assets).toBe("none");
    const result = await core.load({
      documents: { scene: showroom() },
      manifest: MANIFEST,
      files: { "table.glb": "/table.glb" },
    });
    expect(result).toEqual({ ok: true, entities: 14, warnings: [] });
    const stats = core.stats(false);
    expect(stats.assets).toBe("ready");
    expect(stats.entities).toBe(14);
    expect(stats.memory).toEqual({ geometries: 1, textures: 2, programs: 3 });
    expect(stats.loads[TABLE_ASSET]).toBe("ready");
    // The first document camera in ID order draws the frame.
    expect(frames.at(-1)?.camera).toBe("front");
    core.dispose();
  });

  it("applies a patch with no new load, refuses a bad op, and frees the asset of a removed entity", async () => {
    const frames: Frame[] = [];
    const assets = new FakeAssets();
    const core = documentCore(frames, assets);
    core.start();
    await core.load({ documents: { scene: showroom() } });
    const loads = assets.totalLoads();
    const moved = await core.patch([{ op: "set", path: "/entities/table/components/transform/position/0", value: 2 }]);
    expect(moved).toEqual({ ok: true, warnings: [] });
    expect(assets.totalLoads()).toBe(loads);
    expect(frames.at(-1)?.entities.table?.[12]).toBeCloseTo(2, 6);
    const bad = await core.patch([{ op: "remove", id: "no-such-entity" }]);
    expect(bad.ok).toBe(false);
    expect(bad.ok ? -1 : bad.index).toBe(0);
    expect(core.builder.assetUsers(TABLE_ASSET)).toBe(1);
    await core.patch([{ op: "remove", id: "table" }]);
    expect(core.builder.assetUsers(TABLE_ASSET)).toBe(0);
    expect(core.stats(false).loads[TABLE_ASSET]).toBeUndefined();
    core.dispose();
  });

  it("refuses a patch before a load and an unknown camera", async () => {
    const core = documentCore([], new FakeAssets());
    expect((await core.patch([])).ok).toBe(false);
    await core.load({ documents: { scene: showroom() } });
    expect(core.useCamera("no-such-camera")).toBe(false);
    expect(core.useCamera("top")).toBe(true);
    core.dispose();
  });

  it("picks the entity, the component and the model node under a point", async () => {
    const core = documentCore([], new FakeAssets());
    await core.load({ documents: { scene: showroom() } });
    core.useCamera("top");
    const hits = new Map<string, unknown>();
    for (let x = 20; x < SURFACE.width; x += 40) {
      for (let y = 20; y < SURFACE.height; y += 40) {
        const hit = core.pickEntity(x, y);
        if (hit !== null) hits.set(hit.entity, hit);
      }
    }
    expect(hits.get("table")).toMatchObject({
      entity: "table",
      component: "model",
      target: { kind: "node", id: "body" },
    });
    expect(hits.get("floor")).toMatchObject({ entity: "floor", target: null });
    core.dispose();
  });
});

describe("the generic scene worker", () => {
  it("draws the same frame from the messages as the core on the main thread from the calls", async () => {
    const mainFrames: Frame[] = [];
    const main = documentCore(mainFrames, new FakeAssets());
    main.start();
    const ops = [{ op: "set", path: "/entities/table/components/transform/position/2", value: -0.5 }] as const;
    await main.load({ documents: { scene: showroom() } });
    main.useCamera("top");
    await main.patch([...ops]);

    const workerFrames: Frame[] = [];
    const answers: FromWorker[] = [];
    let deliver: ((event: MessageEvent<ToWorker>) => void) | null = null;
    const answered = (type: string) =>
      new Promise<void>((resolve) => {
        const poll = () => (answers.some((answer) => answer.type === type) ? resolve() : setTimeout(poll, 1));
        poll();
      });
    attachSceneWorker(
      {
        addEventListener: (_type, listener) => {
          deliver = listener;
        },
        postMessage: (message) => answers.push(structuredClone(message)),
        requestAnimationFrame: (callback) => setTimeout(callback, 0),
        cancelAnimationFrame: (handle) => {
          clearTimeout(handle);
        },
      },
      fakeBackend(workerFrames),
      documentWorkerFactory(
        (options) =>
          new DocumentCore({
            ...options,
            assetSource: () => new FakeAssets(),
            environmentMaps: FAKE_MAPS,
          }),
      ),
    );
    const send = (message: ToWorker) => deliver?.({ data: structuredClone(message) } as MessageEvent<ToWorker>);
    send({
      type: "init",
      protocol: PROTOCOL_VERSION,
      canvas: {} as OffscreenCanvas,
      surface: SURFACE,
      tier: "high",
      flags: { reducedMotion: false, paused: false, visible: true },
      assets: null,
    });
    send({ type: "load", id: 1, documents: { scene: showroom() } });
    await answered("loaded");
    // The view camera is the "camera" message of the protocol, not an extension message.
    send({ type: "camera", id: 2, name: "top" });
    send({ type: "patch", id: 3, ops: [...ops] });
    await answered("patched");
    expect(answers).toContainEqual({ type: "camera", id: 2, ok: true });
    expect(workerFrames.at(-1)).toEqual(mainFrames.at(-1));
    expect(workerFrames.at(-1)?.camera).toBe("top");
    send({ type: "dispose" });
    main.dispose();
  });
});

describe("the KTX2 target of the asset source", () => {
  it("gives the texture support of the backend when the backend is ready, not before", async () => {
    let ready = (): void => undefined;
    let device = false;
    const supports: Promise<TextureSupport>[] = [];
    const lateBackend: RenderBackendFactory = (params) => {
      const backend = fakeBackend([])(params);
      return {
        ...backend,
        ready: new Promise<void>((resolve) => {
          ready = () => {
            device = true;
            resolve();
          };
        }),
        // A WebGPU backend has the features of its device only after `init()`.
        textureSupport: () => ({ gpuFeatures: { has: (name) => device && name === "texture-compression-bc" } }),
      };
    };
    const core = new DocumentCore({
      ...baseOptions([], "main"),
      backend: lateBackend,
      assetSource: (_manifest, support) => {
        supports.push(support);
        return new FakeAssets();
      },
      environmentMaps: FAKE_MAPS,
    });
    expect(supports).toHaveLength(1);
    ready();
    const support = await supports[0];
    expect(support !== undefined && "gpuFeatures" in support && support.gpuFeatures.has("texture-compression-bc")).toBe(
      true,
    );
    core.dispose();
  });
});

describe("the asset source over Manifest 2 records", () => {
  it("loads the file of the LOD tier, else the first LOD, else the first file", () => {
    const lods = [
      { tier: "high", file: "a.high.glb", triangles: 1, meshes: 1, maxTextureSize: 1 },
      { tier: "low", file: "a.low.glb", triangles: 1, meshes: 1, maxTextureSize: 1 },
    ];
    const withLods = modelRecord("a1", ["a.high.glb", "a.low.glb"], lods);
    expect(recordFile(withLods, "low")).toBe("a.low.glb");
    expect(recordFile(withLods, "ultra")).toBe("a.high.glb");
    expect(recordFile(modelRecord("b1", ["b.gltf"]), "low")).toBe("b.gltf");
    const files = { "a.low.glb": "/built/a.low.glb", "b.gltf": "/sources/b.gltf" };
    const source = new ManifestAssets({
      manifest: manifestOf([withLods, modelRecord("b1", ["b.gltf"])]),
      files,
      tier: "low",
    });
    expect(source.url("asset:a1")).toBe("/built/a.low.glb");
    expect(source.url("asset:b1")).toBe("/sources/b.gltf");
    expect(() => source.url("asset:c1")).toThrow("the asset manifest has no asset:c1");
  });
});

describe("the hot reload of assets in the document core", () => {
  it("loads a model and the environment map again with no new build, and the camera stays", async () => {
    const frames: Frame[] = [];
    const assets = new FakeAssets();
    const core = documentCore(frames, assets);
    core.start();
    await core.load({ documents: { scene: showroom() } });
    core.useCamera("top");
    const environment = showroom().environment?.map ?? "";
    const before = assets.totalLoads();
    const result = await core.load({ reload: [TABLE_ASSET, environment] });
    expect(result).toEqual({ ok: true, entities: 14, warnings: [] });
    expect(assets.totalLoads()).toBe(before + 2);
    expect(assets.loads.get(environment)).toBe(2);
    expect(core.builder.assetUsers(TABLE_ASSET)).toBe(1);
    expect(core.stats(false).loads[TABLE_ASSET]).toBe("ready");
    expect(frames.at(-1)?.camera).toBe("top");
    core.dispose();
  });
});
