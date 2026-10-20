<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The layer of the import by drop over the scene. It shows the hint when a file is over the scene, and the form for
 * the source and the licence of a drop in the workbench. It also shows the state of the import and the list of the
 * models in the scene with their label ("preview, not optimized" for a quick preview).
 *
 * The texts are Fluent messages of `src/i18n/en-US/import.ftl`. The file names are data.
 */
import { cn } from "@scenity/ui";
import { X } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import { ref } from "vue";
import { button } from "../labUi";
import type { ImportDrop } from "./useImportDrop";

const props = defineProps<{ readonly drop: ImportDrop }>();
const { $t } = useI18n();

const source = ref("");
const licence = ref("");
const field =
  "min-h-8 w-full rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption text-text-primary";

function send(): void {
  props.drop.send(source.value, licence.value);
  source.value = "";
  licence.value = "";
}

function point(at: readonly number[]): string {
  return at.map((value) => value.toFixed(2)).join(", ");
}
</script>

<template>
  <div
    v-if="drop.dragging.value"
    class="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed border-accent-brand bg-accent-brand/10 text-label"
    data-testid="lab-import-hint"
  >
    {{ $t("import-hint") }}
  </div>
  <form
    v-if="drop.pending.value !== null"
    class="absolute bottom-24 left-3 z-20 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-card bg-surface-overlay/95 px-3 py-2 text-caption shadow-overlay"
    data-testid="lab-import-form"
    @submit.prevent="send"
  >
    <span class="text-label">{{ $t("import-title", { name: drop.pending.value.name }) }}</span>
    <span class="text-text-secondary">
      {{
        drop.pending.value.point === null
          ? $t("import-no-point")
          : $t("import-point", { point: point(drop.pending.value.point.at) })
      }}
    </span>
    <label class="flex flex-col gap-0.5" for="lab-import-source">
      {{ $t("import-source") }}
      <input id="lab-import-source" v-model="source" :class="field" data-testid="lab-import-source" />
    </label>
    <label class="flex flex-col gap-0.5" for="lab-import-licence">
      {{ $t("import-licence") }}
      <input id="lab-import-licence" v-model="licence" :class="field" data-testid="lab-import-licence" />
    </label>
    <div class="flex gap-2">
      <button type="submit" :class="button" data-testid="lab-import-send">{{ $t("import-send") }}</button>
      <button type="button" :class="button" @click="drop.cancel()">{{ $t("import-cancel") }}</button>
    </div>
  </form>
  <div
    v-if="drop.previews.value.length > 0 || drop.status.value !== null"
    class="absolute bottom-24 right-3 z-10 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-card bg-surface-overlay/95 px-3 py-2 text-caption shadow-overlay"
    data-testid="lab-import-list"
  >
    <p v-if="drop.status.value !== null" class="m-0 text-text-secondary" data-testid="lab-import-status">
      {{ drop.status.value }}
    </p>
    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      <li v-for="item in drop.previews.value" :key="item.id" class="flex items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate"
          :title="$t('import-model-title', { name: item.name, point: point(item.at) })"
          ><span translate="no">{{ item.name }}</span></span
        >
        <span class="shrink-0 text-status-caution" data-testid="lab-import-label">{{ item.label }}</span>
        <button
          type="button"
          :class="cn(button, 'inline-flex size-6 shrink-0 items-center justify-center p-0')"
          :aria-label="$t('import-remove', { name: item.name })"
          @click="drop.remove(item.id)"
        >
          <X class="size-3" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
