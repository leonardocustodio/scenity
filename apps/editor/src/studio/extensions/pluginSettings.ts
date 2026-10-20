// SPDX-License-Identifier: Apache-2.0
/**
 * The settings of a plugin (the `settings` point of a studio face). They are the values of the person in the browser
 * storage (`scenity.plugin.<id>.settings`), and the sections of Preferences. Each section has the JSON Schema of its
 * values, and Preferences shows a form of it (scene/settings/PluginSettingsFields.vue).
 */
import { shallowReactive, shallowRef, type ShallowRef } from "vue";

type Values = Readonly<Record<string, unknown>>;

/** The settings of one plugin: the current values, a change, and a listener of the changes. */
export interface PluginSettingsStore {
  value(): Values;
  set(value: Values): void;
  listen(listener: () => void): () => void;
  /** The values as a ref, for a form. */
  readonly ref: ShallowRef<Values>;
}

const keyOf = (plugin: string): string => `scenity.plugin.${plugin}.settings`;

function read(plugin: string): Values {
  try {
    const text = globalThis.localStorage.getItem(keyOf(plugin));
    const value: unknown = text === null ? {} : JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Values) : {};
  } catch {
    return {};
  }
}

const stores = new Map<string, PluginSettingsStore>();

/** The settings of a plugin (one store for each plugin). */
export function pluginSettingsStore(plugin: string): PluginSettingsStore {
  const known = stores.get(plugin);
  if (known !== undefined) return known;
  const ref = shallowRef<Values>(read(plugin));
  const listeners = new Set<() => void>();
  const store: PluginSettingsStore = {
    ref,
    value: () => ref.value,
    set: (value) => {
      ref.value = value;
      try {
        globalThis.localStorage.setItem(keyOf(plugin), JSON.stringify(value));
      } catch {
        // No storage: the values stay for this page.
      }
      for (const listener of listeners) listener();
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  stores.set(plugin, store);
  return store;
}

/** A section of a plugin: in Preferences (the values of the person) or in Project settings (the project values). */
export interface PluginSettingsSection {
  readonly plugin: string;
  readonly scope: "user" | "project";
  readonly title: () => string;
  readonly schema: unknown;
  readonly store: PluginSettingsStore;
}

/** The sections of the plugins, in their order. */
export const PLUGIN_SETTINGS = shallowReactive<PluginSettingsSection[]>([]);

/** Add a section. The result removes it. */
export function addSettingsSection(section: PluginSettingsSection): () => void {
  PLUGIN_SETTINGS.push(section);
  return () => {
    const at = PLUGIN_SETTINGS.indexOf(section);
    if (at >= 0) PLUGIN_SETTINGS.splice(at, 1);
  };
}
