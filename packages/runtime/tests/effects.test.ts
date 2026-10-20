// SPDX-License-Identifier: Apache-2.0
// The post-processing of the document core. A scene with no effect value draws directly and loads no pipeline. The
// effect values draw through the pipeline of the backend under the tier caps. The selection of `select` (also the
// "select" message of the worker) draws the outline of its objects. A new value makes a new pipeline and releases the
// previous one. A pipeline that does not load leaves the frames with no effect. Three.js runs with no renderer: a fake
// backend and a fake pipeline record the frames.
import { describe, expect, it } from "bun:test";
import { Texture, type Object3D } from "three";
import type { PostFactory, PostSettings } from "@scenity/render/postTypes";
import type { RenderBackend } from "@scenity/render/types";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { DocumentCore } from "../src/core/documentCore";
import type { PostLoader } from "../src/core/effectsHost";
import type { SceneCoreOptions, Tier } from "../src/protocol";
import { handleDocumentMessage } from "../src/worker/documentMessages";
import { FakeAssets, showroom } from "./sceneHelpers";

/** What the fakes record: the plain frames, the pipelines with their settings, the effect frames and the disposals. */
interface Record {
  plain: number;
  readonly pipelines: PostSettings[];
  readonly drawn: (readonly Object3D[])[];
  disposed: number;
}

function fakeBackend(record: Record): () => RenderBackend {
  return () => ({
    kind: "webgl",
    renderer: {
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
    },
    isReady: () => true,
    ready: Promise.resolve(),
    render: () => {
      record.plain += 1;
    },
    info: () => ({ calls: 0, triangles: 0 }),
    memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
    timer: () => null,
    textureSupport: () => ({ gpuFeatures: { has: () => false } }),
    dispose: () => undefined,
  });
}

/** A loader of a fake pipeline factory. `fail` makes the factory throw. */
function fakeLoader(record: Record, fail = false): PostLoader {
  const factory: PostFactory = (_renderer, _scene, _camera, settings) => {
    if (fail) return Promise.reject(new Error("no pipeline"));
    record.pipelines.push(settings);
    return Promise.resolve({
      render: (selected) => record.drawn.push(selected),
      dispose: () => {
        record.disposed += 1;
      },
    });
  };
  return () => Promise.resolve(factory);
}

function core(record: Record, tier: Tier, loader: PostLoader | undefined): DocumentCore {
  const options: SceneCoreOptions = {
    canvas: {} as OffscreenCanvas,
    surface: { width: 640, height: 400, dpr: 1 },
    tier,
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
    backend: fakeBackend(record),
  };
  return new DocumentCore({
    ...options,
    assetSource: () => new FakeAssets(),
    environmentMaps: () => ({
      fromEquirectangular: () => new Texture(),
      fromCubemap: () => new Texture(),
      dispose: () => undefined,
    }),
    ...(loader === undefined ? {} : { postEffects: loader }),
  });
}

/** The showroom with each effect enabled. */
function effectsScene(): SceneDocument {
  const doc = showroom();
  return {
    ...doc,
    environment: {
      ...doc.environment,
      ao: { radius: 0.4 },
      bloom: { strength: 0.7 },
      antialias: "smaa",
      outline: { colour: "#ff0000", thickness: 2 },
    },
  };
}

const fresh = (): Record => ({ plain: 0, pipelines: [], drawn: [], disposed: 0 });

describe("the effects of the document core", () => {
  it("draws a scene with no effect value as before and loads no pipeline", async () => {
    const record = fresh();
    let loads = 0;
    const loader: PostLoader = () => {
      loads += 1;
      return fakeLoader(record)();
    };
    const scene = core(record, "ultra", loader);
    scene.start();
    await scene.load({ documents: { scene: showroom() } });
    expect(loads).toBe(0);
    expect(record.plain).toBeGreaterThan(0);
    expect(scene.stats(false).effects).toEqual([]);
    scene.dispose();
  });

  it("draws the effects of the tier through the pipeline, and the load answers after its first frame", async () => {
    const record = fresh();
    const scene = core(record, "ultra", fakeLoader(record));
    scene.start();
    await scene.load({ documents: { scene: effectsScene() } });
    expect(record.pipelines).toHaveLength(1);
    expect(record.pipelines[0]).toMatchObject({ ao: { radius: 0.4, intensity: 1 }, antialias: "smaa", outline: null });
    expect(record.drawn.length).toBeGreaterThan(0);
    expect(scene.stats(false).effects).toEqual(["ao", "bloom", "smaa"]);
    // The high tier has no ambient occlusion and caps SMAA to FXAA.
    scene.setTier("high");
    await scene.patch([]);
    expect(record.pipelines.at(-1)).toMatchObject({ ao: null, antialias: "fxaa" });
    expect(record.disposed).toBe(1);
    scene.dispose();
  });

  it("draws with no pipeline on the low tier", async () => {
    const record = fresh();
    const scene = core(record, "low", fakeLoader(record));
    await scene.load({ documents: { scene: effectsScene() } });
    expect(record.pipelines).toHaveLength(0);
    expect(scene.stats(false).effects).toEqual([]);
    scene.dispose();
  });

  it("draws the outline of the selection, also from the select message of the worker", async () => {
    const record = fresh();
    const scene = core(record, "low", fakeLoader(record));
    scene.start();
    await scene.load({ documents: { scene: showroom() } });
    expect(handleDocumentMessage({ type: "select", ids: ["table", "no-such-entity"] }, scene)).toBe(true);
    expect(handleDocumentMessage({ type: "debug", layers: [] }, scene)).toBe(false);
    await scene.patch([]);
    expect(scene.stats(false).effects).toEqual(["outline"]);
    expect(record.pipelines.at(-1)?.outline).toMatchObject({ thickness: 1, strength: 3 });
    const selected = record.drawn.at(-1);
    expect(selected).toHaveLength(1);
    expect(selected?.[0]).toBe(scene.builder.entityObject("table"));
    // No selection: the frame draws with no effect again.
    const plain = record.plain;
    scene.select([]);
    await scene.patch([]);
    expect(record.plain).toBeGreaterThan(plain);
    expect(scene.stats(false).effects).toEqual([]);
    scene.dispose();
  });

  it("makes a new pipeline for a new value and frees the old one", async () => {
    const record = fresh();
    const scene = core(record, "ultra", fakeLoader(record));
    await scene.load({ documents: { scene: effectsScene() } });
    await scene.patch([{ op: "set", path: "/environment/bloom/on", value: false }]);
    expect(record.pipelines).toHaveLength(2);
    expect(record.pipelines[1]?.bloom).toBeNull();
    expect(record.disposed).toBe(1);
    scene.dispose();
    expect(record.disposed).toBe(2);
  });

  it("draws the frames with no effect when the pipeline does not load", async () => {
    const record = fresh();
    const scene = core(record, "ultra", fakeLoader(record, true));
    const result = await scene.load({ documents: { scene: effectsScene() } });
    expect(result.ok).toBe(true);
    expect(record.plain).toBeGreaterThan(0);
    expect(scene.stats(false).failures?.[0]).toContain("the effect pipeline did not load");
    scene.dispose();
  });
});
