// SPDX-License-Identifier: Apache-2.0
/**
 * The project settings of a plugin (the `settings` point with `scope: "project"`): the values in
 * `.scenity/plugin-settings.json` of the project (scripts/pluginSettingsApi.ts). The store reads them once, and each
 * change writes them to the project immediately.
 */
import { shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import type { PluginSettingsStore } from "../../studio/extensions/pluginSettings";

type Values = Readonly<Record<string, unknown>>;

const stores = new Map<string, PluginSettingsStore>();

/** The project settings of a plugin of the project folder `base` (its URL with a "/" at the end). */
export function projectSettingsStore(base: string, plugin: string): PluginSettingsStore {
  const key = `${base}${plugin}`;
  const known = stores.get(key);
  if (known !== undefined) return known;
  const ref = shallowRef<Values>({});
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) listener();
  };
  void fetch(`${base}plugin.settings.json`, { cache: "no-store" })
    .then(async (answer) => (answer.ok ? ((await answer.json()) as { values?: Record<string, Values> }) : {}))
    .then((read: { values?: Record<string, Values> }) => {
      ref.value = read.values?.[plugin] ?? {};
      tell();
    })
    .catch(() => undefined);
  const store: PluginSettingsStore = {
    ref,
    value: () => ref.value,
    set: (value) => {
      ref.value = value;
      tell();
      void fetch(`${base}plugin.settings.write`, {
        method: "POST",
        headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
        body: JSON.stringify({ plugin, values: value }),
      }).catch(() => undefined);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  stores.set(key, store);
  return store;
}
