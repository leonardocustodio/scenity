// SPDX-License-Identifier: Apache-2.0
/**
 * The icon of a component card of the inspector: an icon for each built-in component, and
 * one icon for the components of plugins.
 */
import { markRaw, shallowReactive, type Component } from "vue";
import {
  Box,
  Eye,
  Footprints,
  Globe,
  Lightbulb,
  Move3d,
  Package,
  Palette,
  PersonStanding,
  Plug,
  Puzzle,
  Route,
  Shapes,
  StickyNote,
  Video,
  Volume2,
} from "lucide-vue-next";

const ICONS: Readonly<Record<string, Component>> = {
  transform: Move3d,
  model: Box,
  light: Lightbulb,
  camera: Video,
  shape: Shapes,
  audioSource: Volume2,
  annotation: StickyNote,
  visibility: Eye,
  environment: Globe,
  material: Palette,
  prefab: Package,
  path: Route,
  socket: Plug,
  standPoint: Footprints,
  character: PersonStanding,
};

/** The icons of the components of the plugins (the `componentIcons` point of a studio face). */
const PLUGIN_ICONS = shallowReactive(new Map<string, Component>());

/** Add the icon of a component of a plugin; the result removes it. */
export function addComponentIcon(id: string, icon: Component): () => void {
  PLUGIN_ICONS.set(id, markRaw(icon));
  return () => PLUGIN_ICONS.delete(id);
}

/** The icon of a component ID. */
export function componentIcon(id: string): Component {
  return ICONS[id] ?? PLUGIN_ICONS.get(id) ?? Puzzle;
}
