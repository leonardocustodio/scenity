// SPDX-License-Identifier: Apache-2.0
/**
 * The rest pose of a model instance: the template of a model (the asset, which no frame poses) keeps the
 * rest transforms of its nodes. A pose mixer and a retarget read the rest pose from the nodes when they start. Thus a
 * driver that starts while another driver poses the instance starts them inside `atRest`.
 */
import type { Object3D } from "three";
import { modelTemplate } from "./presenters/model";

/** The local transform of a node. */
type Transform = Pick<Object3D, "position" | "quaternion" | "scale">;

/** The template of the model of an entity object (the asset at rest), or undefined. */
export function entityTemplate(entity: Object3D): Object3D | undefined {
  const holder = entity.children.find((child) => child.userData.component === "model");
  return holder === undefined ? undefined : modelTemplate(holder);
}

/**
 * Run `work` with the nodes of a model instance at the transforms of its template (the rest pose). Then restore the
 * current transforms. With no template or another node count, `work` reads the current transforms.
 */
export function atRest<T>(instance: Object3D, template: Object3D | undefined, work: () => T): T {
  const nodes: Object3D[] = [];
  const rest: Object3D[] = [];
  instance.traverse((node) => nodes.push(node));
  template?.traverse((node) => rest.push(node));
  if (rest.length !== nodes.length) return work();
  // The root of the instance keeps its transform: the model holder places it.
  const parts = nodes.slice(1);
  const copy = (node: Object3D, from: Transform): void => {
    node.position.copy(from.position);
    node.quaternion.copy(from.quaternion);
    node.scale.copy(from.scale);
  };
  const saved = parts.map((node) => ({
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone(),
  }));
  parts.forEach((node, index) => {
    const from = rest[index + 1];
    if (from !== undefined) copy(node, from);
  });
  try {
    return work();
  } finally {
    parts.forEach((node, index) => {
      const from = saved[index];
      if (from !== undefined) copy(node, from);
    });
  }
}
