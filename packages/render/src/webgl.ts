// SPDX-License-Identifier: Apache-2.0
/**
 * The WebGL backend of the core: the classic WebGLRenderer with the settings of the core (ACES Filmic tone mapping at
 * exposure 1.05, sRGB output, PCF shadow maps), the WebGL context loss events and the timer queries of
 * EXT_disjoint_timer_query_webgl2. A device without WebGPU runs exactly this code. The WebGL entries of the runtime
 * (`documentWorker.ts`, `documentCoreGl.ts`) import it. The WebGPU entries do not.
 */
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from "three";
import { GpuTimer, type TimerContext } from "./gpuTimer";
import type { BackendParams, RenderBackend } from "./types";

export function createWebGLBackend(params: BackendParams): RenderBackend {
  const renderer = new WebGLRenderer({
    canvas: params.canvas,
    antialias: params.antialias,
    alpha: false,
    powerPreference: "default",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = params.canvas as { addEventListener?: (type: string, listener: (event: Event) => void) => void };
  canvas.addEventListener?.("webglcontextlost", (event) => {
    event.preventDefault();
    params.events.context(true);
  });
  canvas.addEventListener?.("webglcontextrestored", () => {
    params.events.context(false);
  });
  return {
    kind: "webgl",
    renderer,
    isReady: () => true,
    ready: Promise.resolve(),
    render: (scene, camera) => {
      renderer.render(scene, camera);
    },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    memory: () => ({
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
    }),
    timer: () => GpuTimer.create(renderer.getContext() as unknown as TimerContext),
    textureSupport: () => ({ renderer }),
    dispose: () => {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
