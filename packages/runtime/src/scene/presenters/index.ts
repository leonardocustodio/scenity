// SPDX-License-Identifier: Apache-2.0
/** The built-in presenters of the scene builder. */
import { PresenterRegistry } from "../registry";
import type { Presenter } from "../types";
import { animatorPresenter } from "./animator";
import { cameraPresenter } from "./camera";
import { lightPresenter } from "./light";
import { modelPresenter } from "./model";
import { shapePresenter } from "./shape";
import { transformPresenter, visibilityPresenter } from "./transform";

export { animatorHolder, animatorPresenter, type AnimatorHolder } from "./animator";
export { cameraPresenter } from "./camera";
export { lightPresenter } from "./light";
export { modelInstance, modelOverrideMaterials, modelPresenter, modelTemplate, showModelTemplate } from "./model";
export { shapeGeometry, shapePresenter } from "./shape";
export { transformPresenter, visibilityPresenter } from "./transform";

/** The built-in presenters, in a stable order. */
export const builtinPresenterList: readonly Presenter[] = [
  transformPresenter,
  visibilityPresenter,
  shapePresenter,
  lightPresenter,
  cameraPresenter,
  modelPresenter,
  animatorPresenter,
];

/** A new registry with the built-in presenters. A plugin adds its presenters with `register`. */
export function builtinPresenters(): PresenterRegistry {
  return new PresenterRegistry(builtinPresenterList);
}
