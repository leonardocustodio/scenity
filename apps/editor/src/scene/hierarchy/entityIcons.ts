// SPDX-License-Identifier: Apache-2.0
/**
 * The icon of an entity in the hierarchy: the icon of its main component. A prefab instance
 * and an entity of a prefab show the prefab icon; then the first of camera, light, character, model, sound, note,
 * shape, path, socket and stand point; an entity with none of them shows the icon of an empty entity.
 */
import type { Component } from "vue";
import {
  Box,
  BoxSelect,
  Footprints,
  Lightbulb,
  Package,
  PersonStanding,
  Plug,
  Route,
  Shapes,
  StickyNote,
  Video,
  Volume2,
} from "lucide-vue-next";

/** The main components in their order, with their icons. */
const MAIN: readonly (readonly [string, Component])[] = [
  ["camera", Video],
  ["light", Lightbulb],
  ["character", PersonStanding],
  ["skinnedModel", PersonStanding],
  ["model", Box],
  ["audioSource", Volume2],
  ["annotation", StickyNote],
  ["shape", Shapes],
  ["path", Route],
  ["socket", Plug],
  ["standPoint", Footprints],
];

/** The icon and the name of the main component of an entity (the kind of its row: entity, instance or prefab). */
export function entityIcon(
  components: Readonly<Record<string, unknown>>,
  kind: "entity" | "instance" | "prefab",
): { readonly icon: Component; readonly component: string } {
  if (kind !== "entity" || "prefab" in components) return { icon: Package, component: "prefab" };
  const found = MAIN.find(([id]) => id in components);
  return found === undefined ? { icon: BoxSelect, component: "empty" } : { icon: found[1], component: found[0] };
}
