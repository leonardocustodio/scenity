// SPDX-License-Identifier: Apache-2.0
/**
 * The edits of the Animator window. Each edit gives a new controller of the `animator` component (its parameters, its
 * layers, their states and their transitions). The window sets the controller as one step (`component.set`), and the
 * schema of the component checks the result. A rename of a state also renames it in the start of its layer and in its
 * transitions. An edit cannot remove a state that a transition or the start names. It cannot remove a parameter that
 * a condition, a blend or a speed names. A refusal throws an Error with its words. The functions are pure and use no
 * DOM.
 */
import type { AnimatorController } from "@scenity/scene/components";
import { t } from "../../texts";

type Layer = AnimatorController["layers"][number];
type Transition = NonNullable<Layer["transitions"]>[number];
type Parameter = NonNullable<AnimatorController["parameters"]>[string];
/** A condition of a transition. */
export type Condition = NonNullable<Transition["when"]>[number];

/** The controller with one layer changed. */
function withLayerOf(
  controller: AnimatorController,
  index: number,
  change: (layer: Layer) => Layer,
): AnimatorController {
  const layer = controller.layers[index];
  if (layer === undefined) throw new Error(t("animator-no-layer"));
  return { ...controller, layers: controller.layers.map((item, at) => (at === index ? change(layer) : item)) };
}

/** A new state that plays a clip. */
export function withState(
  controller: AnimatorController,
  layer: number,
  name: string,
  clip: string,
): AnimatorController {
  return withLayerOf(controller, layer, (item) => {
    if (Object.hasOwn(item.states, name)) throw new Error(t("animator-state-exists", { name }));
    return { ...item, states: { ...item.states, [name]: { motion: { kind: "clip", clip } } } };
  });
}

/** The clip of a state that plays one clip. */
export function withStateClip(
  controller: AnimatorController,
  layer: number,
  name: string,
  clip: string,
): AnimatorController {
  return withLayerOf(controller, layer, (item) => {
    const state = item.states[name];
    if (state === undefined) throw new Error(t("animator-no-state", { name }));
    return { ...item, states: { ...item.states, [name]: { ...state, motion: { kind: "clip", clip } } } };
  });
}

/** Remove a state. The start of the layer and a state that a transition names cannot go (a refusal). */
export function withoutState(controller: AnimatorController, layer: number, name: string): AnimatorController {
  return withLayerOf(controller, layer, (item) => {
    if (item.start === name) throw new Error(t("animator-state-start", { name }));
    if ((item.transitions ?? []).some((move) => move.from === name || move.to === name))
      throw new Error(t("animator-state-used", { name }));
    return { ...item, states: Object.fromEntries(Object.entries(item.states).filter(([key]) => key !== name)) };
  });
}

/** A new name of a state, in the start of the layer and in its transitions too. */
export function renamedState(
  controller: AnimatorController,
  layer: number,
  from: string,
  to: string,
): AnimatorController {
  return withLayerOf(controller, layer, (item) => {
    if (Object.hasOwn(item.states, to)) throw new Error(t("animator-state-exists", { name: to }));
    const rename = (name: string): string => (name === from ? to : name);
    const transitions = item.transitions?.map((move) => ({ ...move, from: rename(move.from), to: rename(move.to) }));
    return {
      ...item,
      start: rename(item.start),
      states: Object.fromEntries(Object.entries(item.states).map(([key, value]) => [rename(key), value])),
      ...(transitions === undefined ? {} : { transitions }),
    };
  });
}

/** The start state of a layer. */
export function withStart(controller: AnimatorController, layer: number, name: string): AnimatorController {
  return withLayerOf(controller, layer, (item) => ({ ...item, start: name }));
}

/** A new transition (last in priority) from a state (or "*") to a state, with its conditions. */
export function withTransition(controller: AnimatorController, layer: number, move: Transition): AnimatorController {
  return withLayerOf(controller, layer, (item) => ({ ...item, transitions: [...(item.transitions ?? []), move] }));
}

/** A transition with new fields. */
export function withTransitionPatch(
  controller: AnimatorController,
  layer: number,
  index: number,
  patch: Partial<Transition>,
): AnimatorController {
  return withLayerOf(controller, layer, (item) => ({
    ...item,
    transitions: (item.transitions ?? []).map((move, at) => (at === index ? { ...move, ...patch } : move)),
  }));
}

/** Remove a transition. */
export function withoutTransition(controller: AnimatorController, layer: number, index: number): AnimatorController {
  return withLayerOf(controller, layer, (item) => ({
    ...item,
    transitions: (item.transitions ?? []).filter((_, at) => at !== index),
  }));
}

/** A new parameter of a type with its default. */
export function withParameter(
  controller: AnimatorController,
  name: string,
  type: Parameter["type"],
): AnimatorController {
  if (Object.hasOwn(controller.parameters ?? {}, name)) throw new Error(t("animator-parameter-exists", { name }));
  const parameter: Parameter = type === "bool" ? { type, default: false } : { type, default: 0 };
  return { ...controller, parameters: { ...controller.parameters, [name]: parameter } };
}

/** The names of the parameters that a condition, a blend or a speed names. */
function usedParameters(controller: AnimatorController): Set<string> {
  const used = new Set<string>();
  for (const layer of controller.layers) {
    for (const move of layer.transitions ?? []) for (const when of move.when ?? []) used.add(when.parameter);
    for (const state of Object.values(layer.states)) {
      if (state.motion.kind === "blend1d") used.add(state.motion.parameter);
      if (state.speedParameter !== undefined) used.add(state.speedParameter);
    }
  }
  return used;
}

/** Remove a parameter. A parameter that a condition, a blend or a speed names cannot go (a refusal). */
export function withoutParameter(controller: AnimatorController, name: string): AnimatorController {
  if (usedParameters(controller).has(name)) throw new Error(t("animator-parameter-used", { name }));
  return {
    ...controller,
    parameters: Object.fromEntries(Object.entries(controller.parameters ?? {}).filter(([key]) => key !== name)),
  };
}

/** A new layer with one state that plays a clip. */
export function withLayer(controller: AnimatorController, name: string, clip: string): AnimatorController {
  if (controller.layers.some((layer) => layer.name === name)) throw new Error(t("animator-layer-exists", { name }));
  const layer: Layer = { name, start: "idle", states: { idle: { motion: { kind: "clip", clip } } } };
  return { ...controller, layers: [...controller.layers, layer] };
}

/** The weight or the blend of a layer. */
export function withLayerPatch(
  controller: AnimatorController,
  index: number,
  patch: Partial<Pick<Layer, "weight" | "blend">>,
): AnimatorController {
  return withLayerOf(controller, index, (item) => ({ ...item, ...patch }));
}

/** The words of a motion: its clip, or the clips of a blend on its parameter. */
export function motionWords(state: Layer["states"][string]): string {
  const { motion } = state;
  if (motion.kind === "clip") return motion.clip;
  if (motion.kind === "blend1d") return `${motion.parameter}: ${motion.points.map((point) => point.clip).join(" · ")}`;
  return motion.id;
}
