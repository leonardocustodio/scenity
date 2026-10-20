<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Shortcuts window: the key map on a keyboard picture. The person chooses the modifiers and a context. Each key
 * shows its commands, and a key with a clash (two commands in one context) shows in the negative colour. Select a
 * command in the list, then press a key on the picture: the command gets that key (Add keeps its other keys). A press
 * on a key with no selected command shows the commands of the key, each with Remove. Export and Import write and read
 * the key map of the person (`scenity.keymap/1`). Reset all gives each command its default keys.
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { button, field, selectField } from "../inspector/inspectorUi";
import { pageSettings } from "../settings/pageSettings";
import { keyLabel, useSettingsPanel } from "../settings/useSettingsPanel";
import { messageIdOf, textOr } from "../../texts";
import {
  capLabel,
  chordOf,
  contextsOf,
  KEYBOARD,
  keyBindings,
  keymapFile,
  readKeymapFile,
  type Modifiers,
} from "./keyboard";

const { $t } = useI18n();
const state = useSettingsPanel();
const mod = ref(false);
const alt = ref(false);
const shift = ref(false);
const context = ref("all");
const search = ref("");
const picked = ref<string | null>(null);
const add = ref(false);
const chosenKey = ref<string | null>(null);
const note = ref<string | null>(null);

const modifiers = computed<Modifiers>(() => ({ mod: mod.value, alt: alt.value, shift: shift.value }));
const commands = computed(() =>
  state.keymap.value.commands
    .filter((command) => command.keyKind !== "modal")
    .map((command) => ({ ...command, title: textOr(messageIdOf("settings-command", command.id), command.title) })),
);
const contexts = computed(() => contextsOf(commands.value));
const scope = computed(() => (context.value === "all" ? null : context.value));
const bindings = computed(() => keyBindings(commands.value, modifiers.value, scope.value));
const listed = computed(() => {
  const words = search.value.trim().toLowerCase();
  return commands.value.filter(
    (command) =>
      (scope.value === null || command.context === scope.value) &&
      (words === "" || `${command.id} ${command.title}`.toLowerCase().includes(words)),
  );
});
/** True when the chord of a key has two commands in one context (in the chosen context). */
function clash(key: string): boolean {
  const chord = chordOf(key, modifiers.value);
  return state.keymap.value.conflicts.some(
    (conflict) => conflict.chord === chord && (scope.value === null || conflict.contexts.includes(scope.value)),
  );
}

function press(key: string): void {
  const id = picked.value;
  if (id === null) {
    chosenKey.value = chosenKey.value === key ? null : key;
    return;
  }
  const chord = chordOf(key, modifiers.value);
  const now = commands.value.find((command) => command.id === id)?.keys ?? [];
  state.setKeys(id, add.value ? [...now.filter((item) => item !== chord), chord] : [chord]);
  note.value = $t("shortcuts-set", { id, key: keyLabel(chord) });
  picked.value = null;
}
function removeKey(id: string, key: string): void {
  const chord = chordOf(key, modifiers.value);
  const now = commands.value.find((command) => command.id === id)?.keys ?? [];
  state.setKeys(
    id,
    now.filter((item) => item !== chord),
  );
}

function exportKeys(): void {
  const blob = new Blob([keymapFile(state.keymap.value.user)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "scenity.keymap.json";
  link.click();
  URL.revokeObjectURL(link.href);
}
async function importKeys(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  const read = readKeymapFile(await file.text(), new Set(commands.value.map((command) => command.id)));
  if (!read.ok) {
    note.value = $t("shortcuts-import-bad", { errors: read.errors.join("; ") });
    return;
  }
  pageSettings().setKeymap(read.doc);
  note.value =
    read.unknown.length === 0
      ? $t("shortcuts-imported", { count: Object.keys(read.doc.keys).length })
      : $t("shortcuts-imported-unknown", { count: Object.keys(read.doc.keys).length, ids: read.unknown.join(", ") });
}
function resetAll(): void {
  pageSettings().setKeymap({ format: "scenity.keymap/1", keys: {} });
  note.value = $t("shortcuts-reset-done");
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-2 overflow-hidden p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-shortcuts')"
    data-testid="shortcuts"
  >
    <div class="flex w-64 shrink-0 flex-col gap-1">
      <input
        v-model="search"
        type="search"
        :class="field"
        :placeholder="$t('shortcuts-search')"
        :aria-label="$t('shortcuts-search')"
        data-testid="shortcuts-search"
      />
      <ul class="min-h-0 flex-1 overflow-auto" :aria-label="$t('shortcuts-commands')">
        <li v-for="command in listed" :key="command.id">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-1 rounded-control px-1 py-0.5 text-left hover:bg-surface-raised"
            :class="picked === command.id ? 'bg-surface-raised font-medium' : ''"
            :aria-pressed="picked === command.id"
            :data-testid="`shortcuts-command-${command.id}`"
            @click="picked = picked === command.id ? null : command.id"
          >
            <span class="truncate">{{ command.title }}</span>
            <span class="shrink-0 text-text-secondary" translate="no">{{ command.keys.map(keyLabel).join(" ") }}</span>
          </button>
        </li>
      </ul>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1 overflow-auto">
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1" for="shortcuts-mod">
          <input id="shortcuts-mod" v-model="mod" type="checkbox" data-testid="shortcuts-mod" />
          <span translate="no">{{ keyLabel("Mod+X").replace(/\+?X$/, "") }}</span>
        </label>
        <label class="flex items-center gap-1" for="shortcuts-alt">
          <input id="shortcuts-alt" v-model="alt" type="checkbox" data-testid="shortcuts-alt" />
          <span translate="no">{{ keyLabel("Alt+X").replace(/\+?X$/, "") }}</span>
        </label>
        <label class="flex items-center gap-1" for="shortcuts-shift">
          <input id="shortcuts-shift" v-model="shift" type="checkbox" data-testid="shortcuts-shift" />
          <span translate="no">{{ keyLabel("Shift+X").replace(/\+?X$/, "") }}</span>
        </label>
        <select
          v-model="context"
          :class="selectField"
          class="w-36"
          :aria-label="$t('shortcuts-context')"
          data-testid="shortcuts-context"
        >
          <option value="all">{{ $t("shortcuts-context-all") }}</option>
          <option v-for="name in contexts" :key="name" :value="name" translate="no">{{ name }}</option>
        </select>
        <label class="flex items-center gap-1" for="shortcuts-add">
          <input id="shortcuts-add" v-model="add" type="checkbox" data-testid="shortcuts-add" />
          {{ $t("shortcuts-add") }}
        </label>
        <button type="button" :class="button" data-testid="shortcuts-export" @click="exportKeys">
          {{ $t("shortcuts-export") }}
        </button>
        <label :class="button" class="cursor-pointer" for="shortcuts-import">
          {{ $t("shortcuts-import") }}
          <input
            id="shortcuts-import"
            type="file"
            accept="application/json,.json"
            class="sr-only"
            data-testid="shortcuts-import"
            @change="importKeys"
          />
        </label>
        <button type="button" :class="button" data-testid="shortcuts-reset" @click="resetAll">
          {{ $t("shortcuts-reset") }}
        </button>
      </div>
      <p class="text-text-secondary">
        {{ picked === null ? $t("shortcuts-hint") : $t("shortcuts-hint-picked", { id: picked }) }}
      </p>
      <p v-if="note !== null" class="text-accent-brand" role="status" data-testid="shortcuts-note">{{ note }}</p>
      <p v-if="state.notice.value !== null" class="text-status-warning" data-testid="shortcuts-clash-note">
        {{ state.notice.value }}
      </p>
      <div class="flex flex-col gap-0.5" role="group" :aria-label="$t('shortcuts-keyboard')" data-testid="keyboard">
        <div v-for="(row, index) in KEYBOARD" :key="index" class="flex gap-0.5">
          <template v-for="(cap, place) in row" :key="`${cap.key}-${place}`">
            <span v-if="cap.key === ''" :style="{ width: `${cap.width * 3}rem` }" class="shrink-0" />
            <button
              v-else
              type="button"
              class="flex h-11 shrink-0 flex-col items-start justify-between overflow-hidden rounded-control border px-1 py-0.5 text-left hover:border-border-strong"
              :class="[
                clash(cap.key) ? 'border-status-negative text-status-negative' : 'border-border-subtle',
                chosenKey === cap.key ? 'bg-surface-raised' : 'bg-surface-sunken',
              ]"
              :style="{ width: `${cap.width * 3}rem` }"
              :title="(bindings.get(cap.key) ?? []).map((command) => command.title).join(', ')"
              :data-key="cap.key"
              :data-bound="String(bindings.get(cap.key)?.length ?? 0)"
              :data-clash="clash(cap.key) ? '1' : '0'"
              :data-testid="`key-${cap.key}`"
              @click="press(cap.key)"
            >
              <span class="font-medium" translate="no">{{ capLabel(cap.key) }}</span>
              <span class="w-full truncate text-text-secondary">{{ bindings.get(cap.key)?.[0]?.title ?? "" }}</span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="chosenKey !== null" class="flex flex-col gap-0.5" data-testid="shortcuts-key-commands">
        <h4 class="font-medium" translate="no">{{ keyLabel(chordOf(chosenKey, modifiers)) }}</h4>
        <p v-if="(bindings.get(chosenKey) ?? []).length === 0" class="text-text-secondary">
          {{ $t("shortcuts-key-free") }}
        </p>
        <div v-for="command in bindings.get(chosenKey) ?? []" :key="command.id" class="flex items-center gap-1">
          <span>{{ command.title }}</span>
          <span class="text-text-secondary" translate="no">{{ command.context }}</span>
          <button
            type="button"
            :class="button"
            :data-testid="`shortcuts-remove-${command.id}`"
            @click="removeKey(command.id, chosenKey)"
          >
            {{ $t("shortcuts-remove") }}
          </button>
        </div>
      </div>
      <ul v-if="state.keymap.value.conflicts.length > 0" class="text-status-negative" data-testid="shortcuts-clashes">
        <!-- A clash holds data values only: a key, command IDs and contexts. -->
        <li v-for="conflict in state.keymap.value.conflicts" :key="conflict.chord" translate="no">
          {{ keyLabel(conflict.chord) }}: {{ conflict.commands.join(", ") }} ({{ conflict.contexts.join(", ") }})
        </li>
      </ul>
    </div>
  </section>
</template>
