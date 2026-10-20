// SPDX-License-Identifier: Apache-2.0
/**
 * The custom widgets of the inspector: a field with a `custom` hint shows the widget of its name in place of the widget
 * of its schema. A name with no widget here keeps the widget of the schema (an environment hint adds a preview over
 * it). Each widget gets the definition, the path, the value and the label of its field, and
 * writes through the inspector state.
 */
import { markRaw, shallowReactive, type Component } from "vue";
import CharacterIkWidget from "./widgets/CharacterIkWidget.vue";
import ClipSourceWidget from "./widgets/ClipSourceWidget.vue";
import FootLockWidget from "./widgets/FootLockWidget.vue";
import LodChainWidget from "./widgets/LodChainWidget.vue";
import PrefabOverridesWidget from "./widgets/PrefabOverridesWidget.vue";

const WIDGETS: Readonly<Record<string, Component>> = {
  lodChain: LodChainWidget,
  clipSource: ClipSourceWidget,
  prefabOverrides: PrefabOverridesWidget,
  // The foot lock of an animator and the IK goals of a character.
  footLock: FootLockWidget,
  characterIk: CharacterIkWidget,
};

/** The widgets of the plugins (the `widgets` point of a studio face), by the name of their hint. */
const PLUGIN_WIDGETS = shallowReactive(new Map<string, Component>());

/** Add the widget of a plugin for a `custom` hint; the result removes it. */
export function addCustomWidget(name: string, widget: Component): () => void {
  PLUGIN_WIDGETS.set(name, markRaw(widget));
  return () => PLUGIN_WIDGETS.delete(name);
}

/** The custom widget of a name, or null. */
export function customWidget(name: string | undefined): Component | null {
  return name === undefined ? null : (WIDGETS[name] ?? PLUGIN_WIDGETS.get(name) ?? null);
}
