// SPDX-License-Identifier: Apache-2.0
/**
 * The component entry point (`@scenity/scene/components`): `defineComponent`, the registry and the built-in
 * components of the engine.
 */
import { animatorComponent } from "./animator";
import { characterComponent } from "./character";
import { audioSourceComponent } from "./audio";
import type { ComponentDefinition } from "./define";
import { annotationComponent, pickableComponent, prefabComponent, tagsComponent, visibilityComponent } from "./meta";
import {
  locomotionComponent,
  obstacleComponent,
  pathComponent,
  socketComponent,
  standPointComponent,
  transformComponent,
} from "./spatial";
import { cameraComponent, environmentComponent, lightComponent, modelComponent } from "./visual";
import { ComponentRegistry } from "./registry";
import { shapeComponent } from "./shape";

export * from "./animator";
export * from "./character";
export * from "./audio";
export * from "./define";
export * from "./effects";
export * from "./jsonSchema";
export * from "./meta";
export * from "./registry";
export * from "./shape";
export * from "./spatial";
export * from "./visual";

/** The built-in components of the engine, in a stable order. */
export const builtinComponents: readonly ComponentDefinition[] = [
  transformComponent,
  modelComponent,
  shapeComponent,
  lightComponent,
  cameraComponent,
  environmentComponent,
  socketComponent,
  tagsComponent,
  visibilityComponent,
  pickableComponent,
  obstacleComponent,
  standPointComponent,
  pathComponent,
  annotationComponent,
  prefabComponent,
  animatorComponent,
  locomotionComponent,
  audioSourceComponent,
  characterComponent,
];

/** A new registry with the built-in components. A plugin adds its components with `register`. */
export function builtinRegistry(): ComponentRegistry {
  return new ComponentRegistry(builtinComponents);
}
