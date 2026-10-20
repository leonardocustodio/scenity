// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the settings tab of the scene page. It holds the editor settings with their values, their scopes and
 * their sources. It also holds the commands with their keys, the conflicts of the key map, and the capture of a new
 * key. A change of a project setting goes to `scenity.editor.json` of the project. A change of a personal setting or
 * of a key goes to the browser storage. Both changes stay after a reload.
 */
import {
  chordLabel,
  chordOfEvent,
  keyClashes,
  settingSource,
  settingValue,
  SETTING_FIELDS,
  type SettingField,
  type SettingPath,
} from "@scenity/editor-core";
import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from "vue";
import { pageKeys } from "./pageKeys";
import { pageLayout } from "./pageLayout";
import { pageSettings } from "./pageSettings";
import { keymapInfo, setCommandKeys, type KeymapInfo } from "./startEditorSettings";
import { t } from "../../texts";

/** True on macOS: the labels of the keys use ⌘, ⌥ and ⇧. */
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator.platform);

/** The label of a chord on this system. */
export function keyLabel(chord: string): string {
  return chordLabel(chord, MAC);
}

/** A setting row of the panel. */
export interface SettingRow {
  readonly field: SettingField;
  readonly value: number | boolean | string;
  readonly source: "project" | "user" | "default";
}

/** A key capture that waits for a key press: the command, and whether the key replaces the keys or adds one. */
export interface KeyCapture {
  readonly id: string;
  readonly add: boolean;
}

/**
 * The key part of the settings tab: a change of the keys of a command (with the commands that share the new key) and
 * the capture of a new key. The listener of the capture phase takes the next key before the keys of the page.
 */
function useKeyKeys(keymap: Ref<KeymapInfo>, notice: Ref<string | null>) {
  const capture = ref<KeyCapture | null>(null);
  const setKeys = (id: string, keys: readonly string[] | null): void => {
    setCommandKeys(id, keys);
    const map = pageKeys().keyMap();
    const clashes = (keys ?? []).flatMap((chord) => keyClashes(map, pageKeys().commands(), id, chord));
    const commands = [...new Set(clashes)].join(", ");
    notice.value = clashes.length === 0 ? null : t("settings-keys-clash", { id, commands });
  };
  const onCapture = (event: KeyboardEvent): void => {
    const now = capture.value;
    if (now === null) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const chord = event.key === "Escape" && plain ? null : chordOfEvent(event);
    if (chord === null && !(event.key === "Escape" && plain)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    capture.value = null;
    if (chord === null) return;
    const keys = keymap.value.commands.find((command) => command.id === now.id)?.keys ?? [];
    setKeys(now.id, now.add ? [...keys.filter((key) => key !== chord), chord] : [chord]);
  };
  globalThis.addEventListener("keydown", onCapture, { capture: true });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onCapture, { capture: true });
  });
  return {
    capture,
    setKeys,
    startCapture: (id: string, add = false) => {
      capture.value = { id, add };
    },
  };
}

/** The state and the actions of the settings tab. */
export function useSettingsPanel() {
  const settings = pageSettings();
  const info = shallowRef(settings.info());
  const keymap = shallowRef<KeymapInfo>(keymapInfo());
  const layout = shallowRef(pageLayout().value);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const query = ref("");
  const refresh = (): void => {
    info.value = settings.info();
    keymap.value = keymapInfo();
    layout.value = pageLayout().value;
  };
  const stops = [settings.listen(refresh), pageKeys().listen(refresh), pageLayout().listen(refresh)];

  const rows = computed<SettingRow[]>(() =>
    SETTING_FIELDS.map((field) => ({
      field,
      value: settingValue(info.value.settings, field.path),
      source: settingSource(field.path, info.value.project, info.value.user),
    })),
  );
  const commands = computed(() => {
    const text = query.value.trim().toLowerCase();
    return keymap.value.commands.filter(
      (command) => text === "" || `${command.id} ${command.title}`.toLowerCase().includes(text),
    );
  });
  const conflicted = computed(() => new Set(keymap.value.conflicts.flatMap((conflict) => conflict.commands)));

  const setValue = async (path: SettingPath, value: number | boolean | string | undefined): Promise<void> => {
    const reason = await settings.set(path, value);
    error.value = reason;
    notice.value = reason === null ? null : notice.value;
  };

  const keys = useKeyKeys(keymap, notice);
  onBeforeUnmount(() => {
    for (const stop of stops) stop();
  });

  return {
    info,
    keymap,
    layout,
    rows,
    commands,
    conflicted,
    error,
    notice,
    query,
    setValue,
    ...keys,
    setPanel: (side: "left" | "right", open: boolean) =>
      pageLayout().update(side === "left" ? { leftOpen: open } : { rightOpen: open }),
    resetLayout: () => pageLayout().reset(),
  };
}

export type SettingsPanelState = ReturnType<typeof useSettingsPanel>;
