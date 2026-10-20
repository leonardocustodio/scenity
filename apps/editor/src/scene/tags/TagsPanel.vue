<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Tags panel: each tag and each pick layer of the scene with the number of its entities. A press on a name selects
 * its entities. Rename changes the name on each entity of the scene as one undo step (`tag.rename`,
 * `pickLayer.rename`). The names are data (`translate="no"`).
 */
import { layerUses, tagUses, type NameUse } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { computed, ref } from "vue";
import { button, field } from "../inspector/inspectorUi";

const props = defineProps<{
  doc: { readonly value: SceneDocument };
  select(ids: readonly string[]): void;
  /** Run a command of the window. The result is the reason of a refusal, or null. */
  run(command: string, args: Readonly<Record<string, unknown>>): Promise<string | null>;
}>();
const { $t } = useI18n();

const groups = computed(() => [
  { kind: "tag", title: $t("tags-tags"), command: "tag.rename", uses: tagUses(props.doc.value) },
  { kind: "layer", title: $t("tags-layers"), command: "pickLayer.rename", uses: layerUses(props.doc.value) },
]);
/** The name in the current rename: its kind, its name and the text of the field. */
const editing = ref<{ kind: string; name: string } | null>(null);
const text = ref("");
const error = ref<string | null>(null);

function start(kind: string, use: NameUse): void {
  editing.value = { kind, name: use.name };
  text.value = use.name;
  error.value = null;
}

async function rename(command: string): Promise<void> {
  const now = editing.value;
  const to = text.value.trim();
  editing.value = null;
  if (now === null || to === "" || to === now.name) return;
  error.value = await props.run(command, { from: now.name, to });
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-1 text-caption"
    :aria-label="$t('panel-tags')"
    data-testid="tags-panel"
  >
    <section v-for="group in groups" :key="group.kind" :aria-label="group.title">
      <h3 class="text-label">{{ group.title }}</h3>
      <p v-if="group.uses.length === 0" class="text-text-secondary">{{ $t("tags-none") }}</p>
      <ul>
        <li
          v-for="use in group.uses"
          :key="use.name"
          class="flex items-center gap-1 py-0.5"
          :data-kind="group.kind"
          :data-name="use.name"
          data-testid="tags-row"
        >
          <template v-if="editing?.kind === group.kind && editing.name === use.name">
            <input
              v-model="text"
              type="text"
              :class="field"
              :aria-label="$t('tags-rename-label', { name: use.name })"
              data-testid="tags-rename-input"
              @keydown.enter="rename(group.command)"
              @keydown.escape="editing = null"
            />
          </template>
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 truncate text-left hover:underline"
            translate="no"
            :title="$t('tags-select', { name: use.name })"
            data-testid="tags-select"
            @click="select(use.entities)"
          >
            {{ use.name }}
          </button>
          <span class="text-text-secondary" data-testid="tags-count">{{ use.entities.length }}</span>
          <button type="button" :class="button" data-testid="tags-rename" @click="start(group.kind, use)">
            {{ $t("tags-rename") }}
          </button>
        </li>
      </ul>
    </section>
    <p v-if="error !== null" class="text-text-secondary" role="alert" data-testid="tags-error">{{ error }}</p>
  </section>
</template>
