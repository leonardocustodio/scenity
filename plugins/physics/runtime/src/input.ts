// SPDX-License-Identifier: Apache-2.0
/**
 * The input map of the physics plugin: the default keys of the default actions of a character
 * (`DEFAULT_ACTIONS`). A `physics.character` component can name other actions (`actions`). Forward is -Z: the
 * character walks away from a camera that looks along -Z.
 */
import { defineInputMap } from "@scenity/runtime/inputMap";
import { DEFAULT_ACTIONS } from "./components";

export const physicsInput = defineInputMap({
  keys: {
    [DEFAULT_ACTIONS.forward]: ["KeyW", "ArrowUp"],
    [DEFAULT_ACTIONS.back]: ["KeyS", "ArrowDown"],
    [DEFAULT_ACTIONS.left]: ["KeyA", "ArrowLeft"],
    [DEFAULT_ACTIONS.right]: ["KeyD", "ArrowRight"],
    [DEFAULT_ACTIONS.jump]: ["Space"],
  },
});
