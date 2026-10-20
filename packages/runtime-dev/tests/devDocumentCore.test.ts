// SPDX-License-Identifier: Apache-2.0
// The dev document core: the document core of the runtime with the inspect report, the debug layers and the
// layers of a dev plugin, on a backend with no GPU, and the dev messages of the dev scene worker.
import { describe, expect, test } from "bun:test";
import type { LineSegments, Material, Mesh, Scene } from "three";
import type { RenderBackendFactory } from "@scenity/render/types";
import type { ExtensionMessage, SceneCoreOptions } from "@scenity/runtime/protocol";
import { builtinRegistry, readValue, type SceneDocument } from "@scenity/scene";
import { defineDevPlugin, GENERIC_LAYERS } from "../src/devLayers";
import { DevDocumentCore, VIEWPORT_LAYERS } from "../src/document/devDocumentCore";
import { handleSceneDevMessage } from "../src/document/messages";

/** A backend with no GPU: it draws nothing. */
const fakeBackend: RenderBackendFactory = () => ({
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
  render: () => undefined,
  info: () => ({ calls: 0, triangles: 0 }),
  memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
  timer: () => null,
  textureSupport: () => ({ gpuFeatures: { has: () => false } }),
  dispose: () => undefined,
});

const options: SceneCoreOptions = {
  canvas: {} as OffscreenCanvas,
  surface: { width: 640, height: 400, dpr: 1 },
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
  backend: fakeBackend,
};

function core(): DevDocumentCore {
  return new DevDocumentCore({
    ...options,
    assetSource: () => ({ load: () => Promise.reject(new Error("the test has no assets")) }),
  });
}

function scene(): SceneDocument {
  const entities = {
    crate: {
      parent: null,
      index: 0,
      components: { transform: { position: [0, 0.25, 0] }, shape: { kind: "box", size: [0.5, 0.5, 0.5] } },
    },
    front: { parent: null, index: 1, components: { transform: { position: [0, 1, 4] }, camera: { fov: 40 } } },
  };
  const result = readValue({ format: "scenity.scene/1", id: "test", entities }, "scene", {
    registry: builtinRegistry(),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc as SceneDocument;
}

/** The line positions of the debug layers after the next frame. */
async function debugLines(dev: DevDocumentCore): Promise<number> {
  await dev.patch([]);
  const scene = (dev as unknown as { scene: Scene }).scene;
  const lines = scene.getObjectByName("debug-layers")?.children[0] as LineSegments | undefined;
  return lines?.geometry.getAttribute("position").count ?? 0;
}

describe("the dev document core", () => {
  test("it gives the inspect report of its scene and the names of its layers", async () => {
    const dev = core();
    expect(dev.inspect().entities).toEqual([]);
    await dev.load({ documents: { scene: scene() } });
    const report = dev.inspect();
    expect(report.entities.map((entity) => entity.id)).toEqual(["crate", "front"]);
    expect(report.entities[0]?.bounds).toEqual({ min: [-0.25, 0, -0.25], max: [0.25, 0.5, 0.25] });
    // The core layers of the editor viewport come with the generic layers.
    expect([...report.layers.names].sort()).toEqual([...GENERIC_LAYERS, ...VIEWPORT_LAYERS].sort());
    expect(report.layers.on).toEqual([]);
    dev.dispose();
  });

  test("the debug layers draw over the frame, and a dev plugin adds its own layer", async () => {
    const dev = core();
    await dev.load({ documents: { scene: scene() } });
    const marks = defineDevPlugin<number>({
      id: "marks",
      layers: [
        { name: "marks", order: 90, scene: (draw, _input, size) => draw.line([0, 0, 0], [0, size, 0], [1, 1, 1]) },
      ],
    });
    dev.useDevPlugin(marks, () => 2);
    expect(dev.debugLayers()).toContain("marks");
    dev.setDebug(["bounds"]);
    expect(await debugLines(dev)).toBe(24);
    dev.setDebug(["bounds", "marks", "wireframe"]);
    expect(await debugLines(dev)).toBe(26);
    expect([...dev.inspect().layers.on].sort()).toEqual(["bounds", "marks", "wireframe"]);
    dev.dispose();
  });

  test("the dev messages set the layers and answer the report", async () => {
    const dev = core();
    await dev.load({ documents: { scene: scene() } });
    const posted: ExtensionMessage[] = [];
    handleSceneDevMessage({ type: "debug", layers: ["sockets", "lights"] }, dev, (message) => posted.push(message));
    handleSceneDevMessage({ type: "inspectScene", id: 7 }, dev, (message) => posted.push(message));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "sceneInspected",
      id: 7,
      report: { layers: { on: ["sockets", "lights"] } },
    });
    dev.dispose();
  });
});

/** The material type of the mesh of the crate. */
function crateMaterial(dev: DevDocumentCore): string {
  let found = "";
  dev.builder.entityObject("crate")?.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    if (mesh.isMesh === true && found === "") found = (mesh.material as Material).type;
  });
  return found;
}

describe("the viewport layers of the dev document core", () => {
  test("the grid shows, the shading modes put their materials on and back, and the preview leaves the camera", async () => {
    const dev = core();
    await dev.load({ documents: { scene: scene() } });
    const lit = crateMaterial(dev);
    const sceneOf = (dev as unknown as { scene: Scene }).scene;
    dev.setDebug(["grid", "unlit"]);
    await dev.patch([]);
    expect(sceneOf.getObjectByName("editor-grid")?.visible).toBe(true);
    expect(crateMaterial(dev)).toBe("MeshBasicMaterial");
    dev.setDebug(["normalShading"]);
    await dev.patch([]);
    expect(sceneOf.getObjectByName("editor-grid")?.visible).toBe(false);
    expect(crateMaterial(dev)).toBe("MeshNormalMaterial");
    dev.setDebug([]);
    await dev.patch([]);
    expect(crateMaterial(dev)).toBe(lit);
    // A thread with no image bitmaps gives no picture; the frame after it draws again.
    expect(await dev.previewCamera("front", 160)).toBeNull();
    await dev.patch([]);
    dev.dispose();
  });

  test("the editor camera draws in place of the document camera, and the pick uses it", async () => {
    const dev = core();
    await dev.load({ documents: { scene: scene() } });
    // The front camera at (0, 1, 4) looks along -Z of the entity: over the crate.
    expect(dev.useCamera(null, { position: [0, 0.25, 3], target: [0, 0.25, 0], fov: 40, userCamera: true })).toBe(true);
    await dev.patch([]);
    expect(dev.pickEntity(320, 200)?.entity).toBe("crate");
    dev.useCamera(null, { position: [0, 0.25, 3], target: [0, 0.25, 6], fov: 40 });
    await dev.patch([]);
    expect(dev.pickEntity(320, 200)).toBeNull();
    expect(dev.useCamera("nothing", { position: [0, 0, 1], target: [0, 0, 0], fov: 40 })).toBe(false);
    dev.dispose();
  });
});

describe("the split view of the dev document core", () => {
  test("four panes draw in their boxes with their cameras and modes; the pick stays in the main view", async () => {
    const draws: { box: number[]; material: string; camera: string }[] = [];
    let box: number[] = [];
    let dev: DevDocumentCore | null = null;
    const backend: RenderBackendFactory = (made) => {
      const base = fakeBackend(made);
      return {
        ...base,
        renderer: {
          ...base.renderer,
          domElement: { width: 640, height: 400 } as OffscreenCanvas,
          setViewport: (x: number, y: number, width: number, height: number) => {
            box = [x, y, width, height];
          },
        },
        render: (_scene, camera) => {
          if (dev !== null) draws.push({ box, material: crateMaterial(dev), camera: camera.uuid });
        },
      };
    };
    dev = new DevDocumentCore({
      ...options,
      backend,
      assetSource: () => ({ load: () => Promise.reject(new Error("the test has no assets")) }),
    });
    await dev.load({ documents: { scene: scene() } });
    const lit = crateMaterial(dev);
    dev.useCamera(null, { position: [0, 0.25, 3], target: [0, 0.25, 0], fov: 40 });
    const top = { position: [0, 5, 0.01], target: [0, 0, 0], fov: 40 } as const;
    handleSceneDevMessage(
      {
        type: "scenePanes",
        panes: {
          layout: "2x2",
          others: [
            { view: top, camera: null, mode: "unlit" },
            { view: null, camera: "front", mode: "wireframe" },
            { view: top, camera: null, mode: null },
          ],
        },
      },
      dev,
      () => undefined,
    );
    draws.length = 0;
    await dev.patch([]);
    const frame = draws.slice(-4);
    // The classic WebGL renderer measures y from the bottom edge.
    expect(frame.map((draw) => draw.box)).toEqual([
      [0, 200, 320, 200],
      [320, 200, 320, 200],
      [0, 0, 320, 200],
      [320, 0, 320, 200],
    ]);
    expect(frame.map((draw) => draw.material)).toEqual([lit, "MeshBasicMaterial", lit, lit]);
    // The main view keeps its mode after the panes; the pick uses the box of the main view.
    expect(crateMaterial(dev)).toBe(lit);
    expect(dev.pickEntity(160, 100)?.entity).toBe("crate");
    dev.setPanes({ layout: "1", others: [] });
    draws.length = 0;
    await dev.patch([]);
    expect(draws.at(-1)?.box).toEqual([0, 0, 640, 400]);
    expect(dev.pickEntity(320, 200)?.entity).toBe("crate");
    dev.dispose();
  });
});
