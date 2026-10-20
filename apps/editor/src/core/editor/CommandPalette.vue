<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The command palette of the lab page. ⌘P (Ctrl+P on other systems) opens it, in place of the print dialog of the
 * browser. A fuzzy search finds the commands of the registry (editor/commands.ts) by title and ID. Each row shows the
 * key of the command. A command that needs a selection shows only when a selection exists (`available`). Enter or a
 * click runs a command without arguments immediately. A command with arguments opens a small form first. Escape
 * returns from the form, else closes the palette.
 *
 * In the workbench, the lab page is in a frame. ⌘P in the frame opens this palette. ⌘P in the workbench page sends the
 * bridge call `openPalette` (apps/workbench Workbench.vue).
 *
 * The texts are Fluent messages of `src/i18n/en-US/palette.ftl`. The titles, keys and argument docs come from the
 * commands (`src/i18n/en-US/commands*.ftl`). A key chord such as "⌘Z" is a data value (`translate="no"`).
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { button, select } from "../labUi";
import type { ArgSpec, Args, CommandListing } from "./commands";
import { matchCommands } from "./paletteMatch";

const props = defineProps<{
  readonly commands: readonly CommandListing[];
  /** Run a command. Returns null when it ran, else the words of the failure. Then the palette stays open with them. */
  readonly run: (id: string, args: Args) => Promise<string | null>;
  /** The words of the last failure of a key or a button, or null. */
  readonly status?: string | null;
}>();

const open = defineModel<boolean>("open", { default: false });
const { $t } = useI18n();

/** A key chord (for example "⌘Z", "Alt+G" or "1–9"), a data value. A key text with words is a message. */
const CHORD = /^(?:Alt\+|Shift\+|Ctrl\+|Mod\+|⌘|⇧|⌥)*(?:[A-Z0-9]|Escape|Enter|Space|Tab|\d–\d)$/u;

const query = ref("");
const active = ref(0);
/** The command of the argument form, or null for the list. */
const chosen = ref<CommandListing | null>(null);
const values = ref<Record<string, string | boolean>>({});
const error = ref<string | null>(null);
const busy = ref(false);
const field = ref<HTMLInputElement | null>(null);
const listId = useId();
/** The element that had the focus before the palette opened. It gets the focus again when the palette closes. */
let before: HTMLElement | null = null;

const shown = computed(() =>
  matchCommands(
    props.commands.filter((command) => command.available),
    query.value,
  ),
);
const argEntries = computed(() => Object.entries(chosen.value?.args ?? {}));

watch(query, () => {
  active.value = 0;
});

watch(open, async (now) => {
  if (now) {
    before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query.value = "";
    active.value = 0;
    chosen.value = null;
    error.value = null;
    await nextTick();
    field.value?.focus();
  } else {
    before?.focus();
    before = null;
  }
});

/** ⌘P or Ctrl+P: open or close the palette (and stop the print dialog). */
function onKey(event: KeyboardEvent): void {
  if (event.code !== "KeyP" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  event.preventDefault();
  open.value = !open.value;
}

onMounted(() => {
  globalThis.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener("keydown", onKey);
});

/** The start value of a field of the form: the default of the argument, else empty. */
function startValue(spec: ArgSpec): string | boolean {
  if (spec.type === "boolean") return spec.default ?? false;
  if (spec.default !== undefined) return String(spec.default);
  // A list of values without a default starts at its first value (the select shows it).
  return spec.type === "string" && spec.values !== undefined && spec.optional !== true ? (spec.values[0] ?? "") : "";
}

async function runNow(id: string, args: Args): Promise<void> {
  busy.value = true;
  error.value = await props.run(id, args);
  busy.value = false;
  if (error.value === null) open.value = false;
}

async function choose(command: CommandListing | undefined): Promise<void> {
  if (command === undefined) return;
  const entries = Object.entries(command.args);
  if (entries.length === 0) {
    await runNow(command.id, {});
    return;
  }
  chosen.value = command;
  error.value = null;
  values.value = Object.fromEntries(entries.map(([name, spec]) => [name, startValue(spec)]));
  await nextTick();
  document.getElementById(`${listId}-arg-${entries[0]?.[0] ?? ""}`)?.focus();
}

/** The arguments of the form. The form does not send the argument of an empty field (the command uses its default). */
function formArgs(): Args {
  const args: Record<string, number | string | boolean> = {};
  for (const [name, spec] of argEntries.value) {
    const value = values.value[name];
    if (spec.type === "boolean") args[name] = value === true;
    else if (typeof value === "string" && value.trim() !== "") {
      args[name] = spec.type === "number" ? Number(value) : value.trim();
    }
  }
  return args;
}

async function submit(): Promise<void> {
  if (chosen.value !== null) await runNow(chosen.value.id, formArgs());
}

function onListKey(event: KeyboardEvent): void {
  const count = shown.value.length;
  if (event.key === "ArrowDown" && count > 0) {
    event.preventDefault();
    active.value = (active.value + 1) % count;
  } else if (event.key === "ArrowUp" && count > 0) {
    event.preventDefault();
    active.value = (active.value - 1 + count) % count;
  } else if (event.key === "Enter") {
    event.preventDefault();
    void choose(shown.value[active.value]);
  }
}

/** Escape: return from the form to the list, else close. The keys of the lab do not get it. */
function onEscape(): void {
  if (chosen.value === null) {
    open.value = false;
    return;
  }
  chosen.value = null;
  error.value = null;
  void nextTick(() => field.value?.focus());
}

function setValue(name: string, value: string | boolean): void {
  values.value = { ...values.value, [name]: value };
}

function textOf(event: Event): string {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
    ? event.target.value
    : "";
}

function checkedOf(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- the dialog takes Escape from each of its fields. -->
  <section
    v-if="open"
    class="fixed top-16 left-1/2 z-50 flex w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-1.5 rounded-card bg-surface-overlay/95 p-2 text-caption shadow-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="$t('palette-dialog')"
    data-scene-control
    data-testid="lab-palette"
    @keydown.esc.stop.prevent="onEscape"
  >
    <template v-if="chosen === null">
      <div class="flex items-center gap-1">
        <input
          ref="field"
          v-model="query"
          class="min-h-9 flex-1 rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption"
          role="combobox"
          :aria-label="$t('palette-command')"
          aria-autocomplete="list"
          :aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="shown.length > 0 ? `${listId}-${String(active)}` : undefined"
          :placeholder="$t('palette-query')"
          data-testid="lab-palette-query"
          @keydown="onListKey"
        />
        <button
          type="button"
          :class="cn(button, 'inline-flex size-9 items-center justify-center p-0')"
          :title="$t('palette-close')"
          :aria-label="$t('palette-close-label')"
          @click="open = false"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <ul
        :id="listId"
        class="m-0 max-h-80 list-none overflow-auto p-0"
        role="listbox"
        :aria-label="$t('palette-commands')"
      >
        <li v-for="(command, index) in shown" :id="`${listId}-${String(index)}`" :key="command.id">
          <button
            type="button"
            role="option"
            :aria-selected="index === active"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-text-primary',
                index === active && 'bg-surface-raised',
              )
            "
            :data-command="command.id"
            data-testid="lab-palette-item"
            tabindex="-1"
            @mousemove="active = index"
            @click="choose(command)"
          >
            <span class="flex-1 truncate">{{ command.title }}</span>
            <span class="font-mono text-text-secondary" translate="no">{{ command.id }}</span>
            <kbd
              v-if="command.key !== null"
              class="rounded-control border border-border-subtle bg-surface-sunken px-1 font-mono text-text-secondary"
              :translate="CHORD.test(command.key) ? 'no' : undefined"
              data-testid="lab-palette-key"
              >{{ command.key }}</kbd
            >
          </button>
        </li>
        <li v-if="shown.length === 0" class="px-2 py-1.5 text-text-secondary" data-testid="lab-palette-none">
          {{ $t("palette-none") }}
        </li>
      </ul>
    </template>
    <form v-else class="flex flex-col gap-1.5" data-testid="lab-palette-form" @submit.prevent="submit">
      <span class="text-label"
        >{{ chosen.title }} <span class="font-mono text-text-secondary" translate="no">{{ chosen.id }}</span></span
      >
      <label
        v-for="[name, spec] in argEntries"
        :key="name"
        :for="`${listId}-arg-${name}`"
        class="flex flex-col gap-0.5 text-text-secondary"
      >
        <span>
          <span translate="no">{{ name }}</span
          >{{ spec.optional === true || spec.default !== undefined ? "" : " *" }} · {{ spec.description }}
        </span>
        <select
          v-if="spec.type === 'string' && spec.values !== undefined"
          :id="`${listId}-arg-${name}`"
          :class="select"
          :value="values[name]"
          @change="setValue(name, textOf($event))"
        >
          <option v-if="spec.optional === true" value="">{{ $t("palette-arg-none") }}</option>
          <option v-for="value in spec.values" :key="value" :value="value" translate="no">{{ value }}</option>
        </select>
        <input
          v-else-if="spec.type === 'boolean'"
          :id="`${listId}-arg-${name}`"
          type="checkbox"
          class="size-4 self-start"
          :checked="values[name] === true"
          @change="setValue(name, checkedOf($event))"
        />
        <input
          v-else
          :id="`${listId}-arg-${name}`"
          :type="spec.type === 'number' ? 'number' : 'text'"
          step="any"
          class="min-h-8 rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption text-text-primary"
          :value="values[name]"
          :data-arg="name"
          @input="setValue(name, textOf($event))"
        />
      </label>
      <div class="flex gap-1">
        <button type="submit" :class="button" :disabled="busy" data-testid="lab-palette-run">
          {{ $t("palette-run") }}
        </button>
        <button type="button" :class="button" @click="onEscape">{{ $t("palette-back") }}</button>
      </div>
    </form>
    <p v-if="error !== null" class="m-0 text-status-caution" role="status" data-testid="lab-palette-error">
      {{ error }}
    </p>
    <p v-else-if="status" class="m-0 text-text-secondary" role="status">{{ status }}</p>
  </section>
</template>
