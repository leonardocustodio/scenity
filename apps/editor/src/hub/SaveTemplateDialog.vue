<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * "Save as a template" of a project of the Hub: a title and a description. Then the host keeps a copy of the project
 * folder as a template of the person (no outputs and no local state). The new project wizard shows it after the
 * built-in templates.
 */
import { ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog } from "@scenity/ui";
import type { DataTemplate, ProjectInfo } from "./studioApi";
import type { Hub } from "./useHub";

const project = defineModel<ProjectInfo | null>("project", { default: null });
const props = defineProps<{ hub: Hub }>();
const emit = defineEmits<{ saved: [template: DataTemplate] }>();
const { $t } = useI18n();
const title = ref("");
const description = ref("");
const busy = ref(false);
const field = "min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-body";

watch(
  project,
  (now) => {
    title.value = now?.name ?? "";
    description.value = "";
  },
  { immediate: true },
);

async function save(): Promise<void> {
  const from = project.value;
  if (from === null || title.value.trim() === "") return;
  busy.value = true;
  const made = await props.hub.attempt(() =>
    props.hub.api.saveTemplate(from.key, title.value.trim(), description.value.trim()),
  );
  busy.value = false;
  project.value = null;
  if (made !== undefined) emit("saved", made);
}
</script>

<template>
  <Dialog
    :open="project !== null"
    :title="$t('hub-template-save-title')"
    @update:open="project = $event ? project : null"
  >
    <form class="flex flex-col gap-3" data-testid="hub-template-save" @submit.prevent="save">
      <p class="text-caption text-text-secondary">{{ $t("hub-template-save-body") }}</p>
      <label for="hub-template-title" class="flex flex-col gap-1 text-label">
        {{ $t("hub-template-save-name") }}
        <input id="hub-template-title" v-model="title" :class="field" data-testid="hub-template-title" />
      </label>
      <label for="hub-template-about" class="flex flex-col gap-1 text-label">
        {{ $t("hub-template-save-about") }}
        <textarea
          id="hub-template-about"
          v-model="description"
          rows="3"
          :class="field"
          class="py-2"
          data-testid="hub-template-about"
        />
      </label>
      <div class="flex justify-end gap-2">
        <Button @click="project = null">{{ $t("hub-cancel") }}</Button>
        <Button variant="primary" type="submit" :disabled="busy || title.trim() === ''" data-testid="hub-template-go">
          {{ $t("hub-template-save-go") }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
