// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers of the pick tests: a document core with no GPU, the screen point of a world point, and an
 * asset source of the built showroom models (the meshopt decoder of three.js, placeholder KTX2 textures).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Texture, Vector3, type PerspectiveCamera } from "three";
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { RenderBackendFactory, SceneRenderer } from "@scenity/render/types";
import { DocumentCore } from "../src/core/documentCore";
import { project } from "../src/framing";
import type { AssetKind, AssetSource, AssetValue } from "../src/scene/types";
import type { ProjectedFrame, SceneCoreOptions } from "../src/protocol";

export const SURFACE = { width: 640, height: 400, dpr: 1 } as const;

const BUILD = join(import.meta.dir, "../../../samples/showroom/build");

/** A backend with no GPU: it draws nothing. */
export const fakeBackend: RenderBackendFactory = () => {
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
  return {
    kind: "webgl",
    renderer,
    isReady: () => true,
    ready: Promise.resolve(),
    render: () => undefined,
    info: () => ({ calls: 0, triangles: 0 }),
    memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
    timer: () => null,
    textureSupport: () => ({ gpuFeatures: { has: () => false } }),
    dispose: () => undefined,
  };
};

/** The options of a core with a timer scheduler and no clock. Each projected frame goes to `frames`. */
export function coreOptions(frames: ProjectedFrame[]): SceneCoreOptions {
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
    mode: "main",
    events: {
      ready: () => undefined,
      anchors: (frame) => frames.push(frame),
      hit: () => undefined,
      context: () => undefined,
    },
    backend: fakeBackend,
  };
}

/** A document core with no GPU over an asset source. */
export function testCore(assets: AssetSource, frames: ProjectedFrame[] = []): DocumentCore {
  return new DocumentCore({
    ...coreOptions(frames),
    assetSource: () => assets,
    environmentMaps: () => ({
      fromEquirectangular: () => new Texture(),
      fromCubemap: () => new Texture(),
      dispose: () => undefined,
    }),
  });
}

/** The CSS pixel point of a world point on the test canvas. */
export function screenOf(camera: PerspectiveCamera, at: readonly [number, number, number]): [number, number] {
  camera.updateMatrixWorld(true);
  const point = project(camera, new Vector3(...at), SURFACE.width, SURFACE.height);
  return [point.x, point.y];
}

/** A KHR_texture_basisu plugin with no transcoder: each texture is an empty texture. A pick needs no image. */
function placeholderTextures(parser: GLTFParser): GLTFLoaderPlugin {
  parser.loadImageSource = () => Promise.resolve(new Texture());
  return { name: "KHR_texture_basisu", loadTexture: (index: number) => parser.loadTextureImage(index, 0, {} as never) };
}

/** The asset source of the built showroom: the low LOD of each model, and an empty texture for the environment. */
export class ShowroomAssets implements AssetSource {
  async load(ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") return new Texture();
    await MeshoptDecoder.ready;
    const data = readFileSync(join(BUILD, `${ref.slice("asset:".length)}.low.glb`));
    const loader = new GLTFLoader();
    loader.register(placeholderTextures);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
    return gltf.scene;
  }
}
