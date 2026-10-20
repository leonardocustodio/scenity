// SPDX-License-Identifier: Apache-2.0
/**
 * The `light` presenter: a directional, point, spot, ambient or hemisphere light. A directional or spot light points
 * at its target (a world point or an entity). With no target, it points along -Z of the entity. The
 * target object is a child of the light. The values go through `applyLight` (scene/lights.ts). The host applies the
 * limits of the tier and fits the shadow camera to the shadow casters (scene/lighting.ts).
 */
import { AmbientLight, DirectionalLight, HemisphereLight, Object3D, PointLight, SpotLight, Vector3 } from "three";
import type { LightValue } from "@scenity/scene/components";
import { applyLight, type AnyLight } from "../lights";
import type { Presenter } from "../types";
import { targetPoint } from "./target";

const point = new Vector3();

function makeLight(type: LightValue["type"]): AnyLight {
  switch (type) {
    case "directional":
      return new DirectionalLight();
    case "point":
      return new PointLight();
    case "spot":
      return new SpotLight();
    case "ambient":
      return new AmbientLight();
    case "hemisphere":
      return new HemisphereLight();
  }
}

/** Put the target of a directional or spot light at (0, 0, -1) under the light, so the light points along -Z. */
function aimDown(light: DirectionalLight | SpotLight): void {
  light.position.set(0, 0, 0);
  light.target = new Object3D();
  light.target.name = "target";
  light.target.position.set(0, 0, -1);
  light.add(light.target);
}

export const lightPresenter: Presenter<LightValue, AnyLight> = {
  id: "light",
  create(value) {
    const light = makeLight(value.type);
    light.name = `light:${value.type}`;
    if (light instanceof DirectionalLight || light instanceof SpotLight) aimDown(light);
    applyLight(light, value);
    return light;
  },
  update(light, value, previous) {
    if (value.type !== previous.type) return false;
    applyLight(light, value);
    return true;
  },
  dispose(light) {
    light.dispose();
  },
  layout(light, value, ctx) {
    if (!(light instanceof DirectionalLight || light instanceof SpotLight)) return;
    const target = targetPoint(value.target, ctx, point);
    // No target, or a target entity that does not exist: the light points along -Z of the entity.
    if (target === undefined) light.target.position.set(0, 0, -1);
    else light.target.position.copy(light.worldToLocal(target));
    light.target.updateMatrixWorld();
  },
};
