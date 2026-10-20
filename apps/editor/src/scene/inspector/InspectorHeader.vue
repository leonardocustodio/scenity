<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The header of one entity in the inspector: the ID with a copy button, the visible switch,
 * and the tags (a chip with × for each tag, and a field that adds one). Each change is one step of the history. The
 * ID and the tags are data (`translate="no"`).
 */
import { isShown } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import { Circle, Copy, Eye, EyeOff } from "lucide-vue-next";
import { computed, ref } from "vue";
import { pageSequenceKeys } from "../sequencer/sequenceKeys";
import { useInspector } from "./inspectorState";
import { field, iconButton } from "./inspectorUi";

const inspector = useInspector();
const { $t } = useI18n();
const id = computed(() => inspector.one());
const entity = computed(() => (id.value === null ? undefined : inspector.doc.value.entities[id.value]));
const tags = computed(() => entity.value?.tags ?? []);
const shown = computed(() => id.value === null || isShown(inspector.doc.value, id.value));
const copied = ref(false);
/** The record mode of the open sequence (an edit at the time of the clock becomes a key). */
const keys = computed(() => pageSequenceKeys());
const tag = ref("");

function copyId(): void {
  if (id.value === null) return;
  void navigator.clipboard.writeText(id.value).then(() => {
    copied.value = true;
  });
}

function addTag(): void {
  const text = tag.value.trim();
  tag.value = "";
  if (text !== "") inspector.setTags([...tags.value, text]);
}
</script>

<template>
  <div v-if="id !== null && entity !== undefined" class="flex flex-col gap-1" data-testid="inspector-header">
    <div class="flex items-center gap-1">
      <span class="w-28 shrink-0 text-text-secondary">{{ $t("inspector-id") }}</span>
      <code class="min-w-0 flex-1 truncate font-mono" translate="no" data-testid="inspector-id">{{ id }}</code>
      <button
        type="button"
        :class="iconButton"
        :title="copied ? $t('inspector-id-copied') : $t('inspector-id-copy')"
        :aria-label="$t('inspector-id-copy')"
        data-testid="inspector-id-copy"
        @click="copyId"
      >
        <Copy class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="iconButton"
        :aria-pressed="shown"
        :aria-label="shown ? $t('inspector-hide') : $t('inspector-show')"
        :title="shown ? $t('inspector-hide') : $t('inspector-show')"
        data-testid="inspector-visible"
        @click="inspector.setVisible(!shown)"
      >
        <Eye v-if="shown" class="size-3.5" aria-hidden="true" />
        <EyeOff v-else class="size-3.5" aria-hidden="true" />
      </button>
      <button
        v-if="keys !== null"
        type="button"
        :class="[iconButton, keys.recording.value && 'text-status-negative']"
        :aria-pressed="keys.recording.value"
        :aria-label="$t('inspector-record')"
        :title="$t('inspector-record-title')"
        data-testid="inspector-record"
        @click="keys.setRecording(!keys.recording.value)"
      >
        <Circle class="size-3.5" :fill="keys.recording.value ? 'currentColor' : 'none'" aria-hidden="true" />
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-1" :aria-label="$t('inspector-tags')" role="group">
      <span class="w-28 shrink-0 text-text-secondary">{{ $t("inspector-tags") }}</span>
      <span
        v-for="item in tags"
        :key="item"
        class="inline-flex items-center gap-0.5 rounded-control bg-surface-sunken pl-1.5"
        data-testid="inspector-tag"
      >
        <span translate="no">{{ item }}</span>
        <button
          type="button"
          :class="iconButton"
          :aria-label="$t('inspector-tag-remove', { tag: item })"
          :data-testid="`inspector-tag-remove-${item}`"
          @click="inspector.setTags(tags.filter((other) => other !== item))"
        >
          ×
        </button>
      </span>
      <input
        v-model="tag"
        type="text"
        :class="[field, 'w-24 flex-1']"
        :aria-label="$t('inspector-tag-add')"
        :placeholder="$t('inspector-tag-add')"
        data-testid="inspector-tag-add"
        @keydown.enter.prevent="addTag"
      />
    </div>
  </div>
</template>
