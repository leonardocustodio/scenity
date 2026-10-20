// SPDX-License-Identifier: Apache-2.0
/**
 * The light, camera and socket nodes of the glTF export. Each one is a child node of the entity node with the
 * name `<entity>:light`, `<entity>:camera` or `<entity>#<socket>`. A child node gives a camera or a light the rotation
 * to its target and keeps the transform of the entity node equal to the document.
 *
 * - glTF cameras and lights look along -Z of their node, as the runtime does with no target.
 * - KHR_lights_punctual has directional, point and spot lights. An ambient or hemisphere light has no glTF form: its
 *   node keeps the values in `extras.light`, and the export gives a warning.
 * - The light units of three.js (candela, lux) are the units of KHR_lights_punctual, so an intensity stays the same.
 */
import type { Document, Node } from "@gltf-transform/core";
import type { KHRLightsPunctual } from "@gltf-transform/extensions";
import {
  parseRef,
  worldTransform,
  type CameraValue,
  type HasEntities,
  type LightValue,
  type SocketValue,
  type Vec3,
} from "@scenity/scene";
import { linearColour, localRotation, lookRotation } from "./math";

/** The default half angle of a spot cone, as in the runtime (scene/lights.ts). */
const DEFAULT_ANGLE = 0.785398;
/** The clip planes of a camera with no planes in the document, as the camera presenter of the runtime. */
const NEAR = 0.1;
const FAR = 100;
/** The smallest gap between the inner and the outer cone angle: glTF needs inner < outer. */
const CONE_GAP = 1e-4;

/** The world point of a target: a world point, or the origin of an entity. Undefined for a missing entity. */
function targetPoint(scene: HasEntities, target: Vec3 | string | undefined): Vec3 | undefined {
  if (target === undefined) return undefined;
  if (Array.isArray(target)) return target;
  const ref = parseRef(target);
  return ref?.kind === "entity" ? worldTransform(scene, ref.id)?.position : undefined;
}

/** Turn a child node of an entity to its target. With no target, the node keeps the direction -Z of the entity. */
function aim(node: Node, scene: HasEntities, entity: string, target: Vec3 | string | undefined): void {
  const point = targetPoint(scene, target);
  const world = worldTransform(scene, entity);
  if (point === undefined || world === undefined) return;
  node.setRotation(localRotation(world.rotation, lookRotation(world.position, point)));
}

/** The light node of an entity, or a node with `extras.light` for a kind that glTF does not have. */
export function lightNode(
  doc: Document,
  lights: KHRLightsPunctual,
  scene: HasEntities,
  entity: string,
  value: LightValue,
  warn: (message: string) => void,
): Node {
  const node = doc.createNode(`${entity}:light`).setExtras({ entity, component: "light" });
  if (value.type === "ambient" || value.type === "hemisphere") {
    node.setExtras({ entity, component: "light", light: value });
    warn(`${entity}: glTF has no ${value.type} light; the node keeps its values in extras.light`);
    return node;
  }
  const light = lights
    .createLight(entity)
    .setType(value.type)
    .setColor(linearColour(value.colour ?? "#ffffff"))
    .setIntensity(value.intensity ?? 1);
  if (value.type !== "directional" && (value.range ?? 0) > 0) light.setRange(value.range ?? null);
  if (value.type === "spot") {
    const outer = value.angle ?? DEFAULT_ANGLE;
    const inner = outer * (1 - (value.penumbra ?? 0));
    light.setOuterConeAngle(outer).setInnerConeAngle(Math.max(0, Math.min(inner, outer - CONE_GAP)));
  }
  if (value.type !== "point") aim(node, scene, entity, value.target);
  return node.setExtension("KHR_lights_punctual", light);
}

/** The camera node of an entity: a perspective camera with the field of view of the document. */
export function cameraNode(doc: Document, scene: HasEntities, entity: string, value: CameraValue): Node {
  const camera = doc
    .createCamera(entity)
    .setType("perspective")
    .setYFov(((value.fov ?? 50) * Math.PI) / 180)
    .setZNear(value.near ?? NEAR)
    .setZFar(value.far ?? FAR);
  const node = doc.createNode(`${entity}:camera`).setCamera(camera).setExtras({ entity, component: "camera" });
  aim(node, scene, entity, value.target);
  return node;
}

/** The empty socket nodes of an entity, in name order. */
export function socketNodes(doc: Document, entity: string, value: SocketValue): Node[] {
  return Object.entries(value.points ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, point]) => {
      const place = Array.isArray(point) ? { position: point } : point;
      const node = doc
        .createNode(`${entity}#${name}`)
        .setTranslation(place.position)
        .setExtras({ entity, socket: name });
      if (place.rotation !== undefined) node.setRotation(place.rotation);
      return node;
    });
}
