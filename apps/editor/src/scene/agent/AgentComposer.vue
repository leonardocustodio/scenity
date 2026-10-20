<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The composer of the agent panel. It has the chips of the context: ✕ removes one, and ＋ adds a picture file or a
 * region of the Scene view. It has the text field with `@` mentions: ↑ ↓ choose, ↩ or Tab take, and Escape closes.
 * ↑ in an empty field gives the last prompt. Hierarchy rows, asset tiles and picture files can drop on the field.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Menu } from "@scenity/ui";
import { Image, Plus, X } from "lucide-vue-next";
import { ASSET_DRAG_TYPE, ASSET_NAME_DRAG_TYPE } from "../../assetBrowser/assetTypes";
import { ENTITY_DRAG_TYPE, mentionChip, pictureChip, type AgentChip } from "./agentContext";
import { recipeChips } from "./recipes";
import type { AgentStore } from "./agentStore";
import { useViewerReason } from "../../studio/extensions/api";

/** The reason of the lock of a viewer, or null. */
const viewerReason = useViewerReason();
const props = defineProps<{ store: AgentStore; prompts: readonly string[] }>();
const { $t } = useI18n();
const store = props.store;
const field = ref<HTMLTextAreaElement | null>(null);
const files = ref<HTMLInputElement | null>(null);
const mention = ref<{ start: number; query: string } | null>(null);
const highlighted = ref(0);
/** The chips read the window again each second and at each focus of the field. */
const REFRESH_MS = 1000;

const chips = computed(() => {
  const reads = [store.chips.tick.value, store.chips.added.value, store.chips.muted.value];
  return reads.length > 0 ? store.chips.list() : [];
});
// `/` at the start of the field lists the recipes; `@` lists the mentions.
const slash = computed(() => /^\/(\S*)$/.exec(store.draft.value)?.[1] ?? null);
const options = computed(() => {
  if (slash.value !== null) return recipeChips(store.recipes.value, slash.value);
  return mention.value === null || store.context === null ? [] : store.context.mentions(mention.value.query);
});
const draft = computed({ get: () => store.draft.value, set: (text: string) => (store.draft.value = text) });
const addItems = computed(() => [
  { value: "picture", label: $t("agent-add-picture") },
  { value: "region", label: $t("agent-add-region"), disabled: store.context === null },
]);

const refresh = (): void => {
  store.chips.tick.value += 1;
};
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => (timer = setInterval(refresh, REFRESH_MS)));
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});

/** Read the `@` mention before the caret. */
function onInput(): void {
  const element = field.value;
  if (element === null) return;
  const before = element.value.slice(0, element.selectionStart);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  const query = match?.[1];
  mention.value = query === undefined ? null : { start: before.length - query.length - 1, query };
  highlighted.value = 0;
}

/** Take a mention: remove the `@` text from the field and add the chip. A recipe chip runs the recipe. */
function take(chip: AgentChip): void {
  if (chip.kind === "recipe") {
    store.draft.value = "";
    store.runRecipe(chip.key.slice("recipe:".length));
    return;
  }
  const open = mention.value;
  if (open !== null) {
    const text = store.draft.value;
    store.draft.value = text.slice(0, open.start) + text.slice(open.start + 1 + open.query.length);
  }
  store.chips.add(chip);
  mention.value = null;
  field.value?.focus();
}

function onKey(event: KeyboardEvent): void {
  const list = options.value;
  if ((mention.value !== null || slash.value !== null) && list.length > 0) {
    const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      highlighted.value = (highlighted.value + step + list.length) % list.length;
      return;
    }
    const chosen = list[highlighted.value];
    if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey && chosen !== undefined) {
      event.preventDefault();
      take(chosen);
      return;
    }
  }
  if (event.key === "Escape" && mention.value !== null) {
    event.preventDefault();
    mention.value = null;
    return;
  }
  // ↑ in an empty field gives the last prompt of the session again.
  if (event.key === "ArrowUp" && store.draft.value === "" && props.prompts.length > 0) {
    event.preventDefault();
    store.draft.value = props.prompts.at(-1) ?? "";
  }
}

async function addPictures(list: Iterable<File>): Promise<void> {
  for (const file of list) {
    const chip = await pictureChip(file);
    if (chip !== null) store.chips.add(chip);
  }
}

function accepts(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes(ENTITY_DRAG_TYPE) || types.includes(ASSET_DRAG_TYPE) || types.includes("Files");
}

function onDragOver(event: DragEvent): void {
  if (!accepts(event)) return;
  event.preventDefault();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
}

async function onDrop(event: DragEvent): Promise<void> {
  const data = event.dataTransfer;
  if (data === null || !accepts(event)) return;
  event.preventDefault();
  const entities = data.getData(ENTITY_DRAG_TYPE);
  for (const id of entities === "" ? [] : entities.split(","))
    if (store.context !== null) store.chips.add(store.context.entity(id));
  const asset = data.getData(ASSET_DRAG_TYPE);
  if (asset.startsWith("asset:")) {
    const id = asset.slice("asset:".length);
    store.chips.add(mentionChip("asset", id, data.getData(ASSET_NAME_DRAG_TYPE) || id));
  }
  await addPictures(data.files);
}

function onPaste(event: ClipboardEvent): void {
  const list = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (list.length === 0) return;
  event.preventDefault();
  void addPictures(list);
}

async function onAdd(value: string): Promise<void> {
  if (value === "picture") {
    files.value?.click();
    return;
  }
  const chip = await store.context?.region();
  if (chip !== null && chip !== undefined) store.chips.add(chip);
  field.value?.focus();
}

function onFiles(): void {
  const list = files.value?.files;
  if (list !== null && list !== undefined) void addPictures(list);
}
</script>

<template>
  <div class="relative flex flex-col gap-1">
    <ul class="flex flex-wrap items-center gap-1" :aria-label="$t('agent-chips')" data-testid="agent-chips">
      <li
        v-for="chip in chips"
        :key="chip.key"
        class="flex max-w-48 items-center gap-1 rounded-control border border-border-subtle bg-surface-sunken pl-2"
        data-testid="agent-chip"
        :data-kind="chip.kind"
        :data-key="chip.key"
      >
        <Image v-if="chip.picture !== undefined" class="size-icon-sm flex-none" aria-hidden="true" />
        <span class="truncate" :title="chip.title ?? chip.text" :translate="chip.words === true ? undefined : 'no'">
          {{ chip.label }}
        </span>
        <button
          type="button"
          class="flex min-h-6 min-w-6 flex-none items-center justify-center rounded-control hover:bg-surface-overlay"
          :aria-label="$t('agent-chip-remove', { label: chip.label })"
          data-testid="agent-chip-remove"
          @click="store.chips.remove(chip.key)"
        >
          <X class="size-icon-sm" aria-hidden="true" />
        </button>
      </li>
      <li>
        <Menu :items="addItems" @select="onAdd">
          <template #trigger>
            <button
              type="button"
              class="flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface-sunken"
              :title="$t('agent-add')"
              :aria-label="$t('agent-add')"
              data-testid="agent-add"
            >
              <Plus class="size-icon-sm" aria-hidden="true" />
            </button>
          </template>
        </Menu>
      </li>
    </ul>
    <input
      ref="files"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      class="hidden"
      :aria-label="$t('agent-add-picture')"
      data-testid="agent-files"
      @change="onFiles"
    />
    <p v-if="viewerReason !== null" class="text-caption text-text-secondary" data-testid="agent-viewer">
      {{ viewerReason }}
    </p>
    <textarea
      ref="field"
      v-model="draft"
      :disabled="viewerReason !== null"
      :title="viewerReason ?? undefined"
      rows="3"
      class="w-full resize-none rounded-control border border-border-strong bg-surface-raised p-2 text-body"
      :placeholder="$t('agent-composer')"
      :aria-label="$t('agent-composer')"
      role="combobox"
      :aria-expanded="(mention !== null || slash !== null) && options.length > 0"
      aria-controls="agent-mentions"
      aria-autocomplete="list"
      data-testid="agent-composer"
      @input="onInput"
      @keydown="onKey"
      @focus="refresh"
      @paste="onPaste"
      @dragover="onDragOver"
      @drop="onDrop"
    />
    <ul
      v-if="(mention !== null || slash !== null) && options.length > 0"
      id="agent-mentions"
      role="listbox"
      class="absolute bottom-full left-0 z-10 max-h-64 w-full overflow-auto rounded-card border border-border-subtle bg-surface-overlay p-1 shadow-overlay"
      :aria-label="$t('agent-mentions')"
      data-testid="agent-mentions"
    >
      <li
        v-for="(option, index) in options"
        :key="option.key"
        role="option"
        tabindex="-1"
        :aria-selected="index === highlighted"
        class="flex cursor-default gap-2 rounded-control px-2 py-1 aria-selected:bg-surface-sunken"
        data-testid="agent-mention"
        :data-key="option.key"
        @mousedown.prevent="take(option)"
      >
        <span class="text-text-secondary">{{ option.kind }}</span>
        <span class="truncate">{{ option.label }}</span>
      </li>
    </ul>
  </div>
</template>
