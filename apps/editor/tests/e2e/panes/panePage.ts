// SPDX-License-Identifier: Apache-2.0
/**
 * The test page of the pane loop. The renderer of one backend module of the runtime draws two panes on one canvas.
 * Each pane has its viewport, its scissor and its own scene. The split screen uses this loop on both backends.
 * room3d-webgpu-panes.spec.ts bundles this file and reads the canvas.
 */
import { createWebGLBackend } from "@scenity/render/webgl";
import { createWebGPUBackend } from "@scenity/render/webgpu";
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three";

/** The parts of both renderers that the pane loop uses (`SceneRenderer` has them too). */
interface PaneRenderer {
  autoClear: boolean;
  setViewport(x: number, y: number, width: number, height: number): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setScissorTest(on: boolean): void;
  clear(): void;
}

export interface PaneRequest {
  readonly backend: "webgpu" | "webgl";
  /** False: the loop clears the canvas once and each pane draws without a clear. */
  readonly autoClear: boolean;
}

export interface PaneResult {
  readonly kind: string;
  readonly failed: string | null;
}

/** The size of a pane in CSS pixels; the canvas has two panes side by side. */
export const PANE = 100;

/** A scene with a background colour and a white box in the middle of its camera. */
function paneScene(background: number): { scene: Scene; camera: PerspectiveCamera } {
  const scene = new Scene();
  scene.background = new Color(background);
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff })));
  const camera = new PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

async function drawPanes(request: PaneRequest): Promise<PaneResult> {
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "panes";
  canvas.style.cssText = `display:block;width:${String(PANE * 2)}px;height:${String(PANE)}px`;
  document.body.append(canvas);
  let failed: string | null = null;
  const create = request.backend === "webgpu" ? createWebGPUBackend : createWebGLBackend;
  const backend = create({
    canvas,
    antialias: false,
    events: {
      context: () => undefined,
      failed: (reason) => {
        failed = reason;
      },
    },
  });
  await backend.ready;
  const renderer = backend.renderer as typeof backend.renderer & PaneRenderer;
  renderer.setPixelRatio(1);
  renderer.setSize(PANE * 2, PANE, false);
  renderer.autoClear = request.autoClear;
  if (!request.autoClear) renderer.clear();
  // A red and a green that ACES Filmic can give (render/toneClear.ts): both backends show the plain colour.
  const panes = [paneScene(0xd02020), paneScene(0x20b020)];
  renderer.setScissorTest(true);
  panes.forEach(({ scene, camera }, index) => {
    renderer.setViewport(index * PANE, 0, PANE, PANE);
    renderer.setScissor(index * PANE, 0, PANE, PANE);
    if (!request.autoClear) {
      // Without the automatic clear, the background of the pane comes from a clear inside its scissor.
      (renderer as unknown as { setClearColor(color: Color): void }).setClearColor(scene.background as Color);
      renderer.clear();
    }
    backend.render(scene, camera);
  });
  renderer.setScissorTest(false);
  // The GPU errors of the first frame come after the frame (render/webgpu.ts).
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { kind: backend.kind, failed };
}

(globalThis as { __panes?: (request: PaneRequest) => Promise<PaneResult> }).__panes = drawPanes;
