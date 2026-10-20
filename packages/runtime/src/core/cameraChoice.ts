// SPDX-License-Identifier: Apache-2.0
/**
 * The camera of the frames of a document core: a document camera by entity ID or name, the first document camera, or
 * the editor camera at a view of the editor. The editor camera is never in the documents: the core keeps it here, and
 * the "camera" message of the protocol sets its view.
 *
 * Before each frame `aim` sets the aspect, the field of view and the clip planes of the camera of the frame:
 *
 * - A document camera takes its safe frame and the clip planes that its component does not give (scene/cameraFrame.ts).
 * - The editor camera takes the field of view of its view, and its clip planes come from the box of the scene.
 * - Another camera (the camera of SceneCore) takes the aspect only.
 */
import { PerspectiveCamera, type Box3 } from "three";
import type { CameraValue } from "@scenity/scene/components";
import { viewCamera } from "../framing";
import type { EditorView } from "../protocol";
import type { SceneBuilder } from "../scene/builder";
import { clipPlanes, frameDocumentCamera } from "../scene/cameraFrame";

/** The clip planes of the editor camera come from the scene box alone (no plane of a component). */
const NO_PLANES: CameraValue = {};

export class CameraChoice {
  /** The entity ID or name of the document camera; null for the first document camera. */
  name: string | null = null;
  /** The view of the editor camera, or null when a document camera draws. */
  view: EditorView | null = null;
  readonly #editor = new PerspectiveCamera(50, 1, 0.05, 100);

  /** True while the user moves the editor camera: the levels of detail then use their hysteresis. */
  get userCamera(): boolean {
    return this.view?.userCamera === true;
  }

  /** The camera of the frames: the editor camera, the chosen document camera, the first one, or `fallback`. */
  camera(builder: SceneBuilder | null, fallback: PerspectiveCamera): PerspectiveCamera {
    if (this.view !== null) return this.#editor;
    if (builder === null) return fallback;
    if (this.name !== null) return builder.camera(this.name) ?? fallback;
    const first: PerspectiveCamera | undefined = builder.cameras().values().next().value;
    return first ?? fallback;
  }

  /**
   * Set the aspect, the field of view and the clip planes of `camera` for a canvas of `aspect`. `scene` is the box of
   * the scene; `builder` is null before the first document.
   */
  aim(camera: PerspectiveCamera, builder: SceneBuilder | null, scene: Box3, aspect: number): void {
    if (camera === this.#editor && this.view !== null) {
      viewCamera(camera, this.view, aspect);
      camera.updateMatrixWorld();
      const { near, far } = clipPlanes(camera, NO_PLANES, scene);
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      return;
    }
    const value = builder === null ? undefined : cameraValue(builder, camera);
    if (value === undefined || builder === null) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      return;
    }
    frameDocumentCamera(camera, value, scene, (id) => builder.bounds(id), aspect);
  }
}

/** The `camera` component of a document camera with the defaults of the registry, or undefined for another camera. */
function cameraValue(builder: SceneBuilder, camera: PerspectiveCamera): CameraValue | undefined {
  for (const [id, each] of builder.cameras()) {
    if (each !== camera) continue;
    const stored = builder.document().entities[id]?.components.camera;
    return builder.registry.fill("camera", stored ?? {}) as CameraValue;
  }
  return undefined;
}
