// SPDX-License-Identifier: Apache-2.0
/**
 * The `camera` presenter: a `PerspectiveCamera` with the field of view in degrees. With a target (a world point or
 * `entity:<id>`), the camera looks at it. With no target, it looks along -Z of the entity. The host
 * sets the aspect, the safe frame and the clip planes that the document does not give (scene/cameraFrame.ts).
 */
import { PerspectiveCamera, Vector3 } from "three";
import type { CameraValue } from "@scenity/scene/components";
import type { Presenter } from "../types";
import { targetPoint } from "./target";

const point = new Vector3();
/** The clip planes of a new camera, until the host sets them from the bounds of the scene. */
const NEAR = 0.1;
const FAR = 100;

export const cameraPresenter: Presenter<CameraValue, PerspectiveCamera> = {
  id: "camera",
  create(value) {
    const camera = new PerspectiveCamera(value.fov ?? 50, 1, value.near ?? NEAR, value.far ?? FAR);
    camera.name = "camera";
    return camera;
  },
  update(camera, value) {
    camera.fov = value.fov ?? 50;
    camera.near = value.near ?? camera.near;
    camera.far = value.far ?? camera.far;
    camera.updateProjectionMatrix();
    return true;
  },
  dispose() {
    // A camera holds no GPU resource.
  },
  layout(camera, value, ctx) {
    const target = targetPoint(value.target, ctx, point);
    // A target entity that does not exist gives the direction -Z of the entity.
    if (target === undefined) camera.quaternion.identity();
    else camera.lookAt(target);
  },
};
