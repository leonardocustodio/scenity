// SPDX-License-Identifier: Apache-2.0
/**
 * The pick kinds of the plugins. The pick framework knows four kinds: `prop` (a node `prop-<slot>`), `scratch` (a
 * scratch prop), `member` (a member or a node `member:<id>`, `person:<id>`) and `room` (a part without an owner). A
 * plugin registers a classifier for its own kinds: the item of a node name, the graybox object of a prop slot and the
 * object of an outline. The pick in the core and the selection text of the page read the same list, so the plugin
 * registers its classifier in each context (a module that both import).
 *
 * No three.js values: the lab page reads the kinds without the renderer.
 */
import type { Object3D } from "three";

/** The kind of a pick: the kinds of the framework or a kind of a plugin. */
export type PickKind = "prop" | "member" | "room" | "scratch" | (string & Record<never, never>);

/** The kinds of the pick framework. */
export const BASE_PICK_KINDS: readonly PickKind[] = ["prop", "member", "room", "scratch"];

/** An item of a node: its kind and its ID. */
export interface PickItem {
  readonly kind: PickKind;
  readonly id: string;
}

/** The pick rules of a plugin. */
export interface PickClassifier {
  /** A unique name: a second register with the same name replaces the first. */
  readonly name: string;
  /** The kinds that the classifier adds. */
  readonly kinds: readonly PickKind[];
  /** The kinds whose pick names the nearest bone of the skinned mesh that the ray hit. */
  readonly boneKinds?: readonly PickKind[];
  /**
   * The item of a node name, or null. `hit` is the name of the hit object below the node. The framework asks after its
   * `prop` and `scratch` names and before its `member` names.
   */
  item?(name: string, hit: string): PickItem | null;
  /** The object of a prop slot when its model does not show (a graybox part), or undefined for no rule. */
  propObject?(scene: Object3D, slot: string): Object3D | null | undefined;
  /** The object of an item of a kind of the plugin for the outline, or undefined for no rule. */
  outlineObject?(scene: Object3D, item: PickItem): Object3D | null | undefined;
}

const classifiers: PickClassifier[] = [];

/** Register the pick rules of a plugin (a second register with the same name replaces the first). */
export function registerPickClassifier(classifier: PickClassifier): void {
  const at = classifiers.findIndex((other) => other.name === classifier.name);
  if (at >= 0) classifiers[at] = classifier;
  else classifiers.push(classifier);
}

/** The registered classifiers in the order of registration. */
export function pickClassifiers(): readonly PickClassifier[] {
  return classifiers;
}

/** Every kind: the kinds of the framework, then the kinds of the plugins. */
export function pickKinds(): PickKind[] {
  return [...BASE_PICK_KINDS, ...classifiers.flatMap((classifier) => classifier.kinds)];
}

/** True when the pick of a kind names the nearest bone of the skinned mesh that the ray hit. */
export function bonePickKind(kind: PickKind): boolean {
  return classifiers.some((classifier) => classifier.boneKinds?.includes(kind) === true);
}

/** The item of a node name by the classifiers of the plugins, or null. */
export function pluginItemOf(name: string, hit: string): PickItem | null {
  for (const classifier of classifiers) {
    const item = classifier.item?.(name, hit) ?? null;
    if (item !== null) return item;
  }
  return null;
}

/** The first answer of the classifiers that is not undefined, or undefined. */
export function firstAnswer<T>(ask: (classifier: PickClassifier) => T | undefined): T | undefined {
  for (const classifier of classifiers) {
    const answer = ask(classifier);
    if (answer !== undefined) return answer;
  }
  return undefined;
}
