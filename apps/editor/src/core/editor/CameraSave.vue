<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * "Save camera" and the camera bookmarks in the View tab. The name field and its buttons run the commands of the
 * registry: "Bookmark" (`camera.bookmark`, a view in the URL), "Save camera" (`camera.save`, the dry run first), then
 * "Write" (`camera.save` with `dry: false`). The save takes the view of the focused pane. In the workbench, the host
 * runs `labs camera-save` and the output shows here. The lab page alone shows the command to copy. Without the scene
 * editor (a fixed frame), the page has no runner, and this part does not show.
 *
 * The texts are Fluent messages of `src/i18n/en-US/palette.ftl`. A camera name, a run status and a command line are
 * data values (`translate="no"`).
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { computed, inject, ref } from "vue";
import { button, select } from "../labUi";
import { CAMERA_SAVE } from "./useCameraSave";

const { $t } = useI18n();
const context = inject(CAMERA_SAVE, null);
const name = ref("");
const doc = ref("");
const replace = ref(false);
const status = ref<string | null>(null);
const result = computed(() => context?.save.result.value ?? null);
const bookmarks = computed(() => context?.save.bookmarks.value ?? []);

async function run(command: string, args: Readonly<Record<string, string | boolean>>): Promise<void> {
  if (context === null) return;
  status.value = await context.runner.palette(command, args);
}

function saveArgs(dry: boolean): Record<string, string | boolean> {
  const text = doc.value.trim();
  return { name: name.value.trim(), dry, replace: replace.value, ...(text === "" ? {} : { doc: text }) };
}

function write(): void {
  const last = result.value;
  if (last === null) return;
  const text = last.doc ?? "";
  void run("camera.save", {
    name: last.name,
    dry: false,
    replace: last.replace,
    ...(text === "" ? {} : { doc: text }),
  });
}

/** The select key of a Fluent message for a flag. */
function selectKey(on: boolean): "yes" | "no" {
  return on ? "yes" : "no";
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    status.value = $t("palette-camera-copied");
  } catch {
    status.value = $t("palette-camera-no-clipboard");
  }
}
</script>

<template>
  <section
    v-if="context !== null"
    class="flex flex-col gap-1.5"
    :aria-label="$t('palette-camera-save')"
    data-testid="lab-camera-save"
  >
    <h3 class="text-label text-text-secondary">{{ $t("palette-camera-save") }}</h3>
    <form class="flex flex-col gap-1.5" @submit.prevent="run('camera.save', saveArgs(true))">
      <label for="lab-camera-name" class="flex flex-col">
        <span class="sr-only">{{ $t("palette-camera-name") }}</span>
        <input
          id="lab-camera-name"
          v-model="name"
          :class="select"
          :placeholder="$t('palette-camera-name-hint')"
          data-testid="lab-camera-name"
        />
      </label>
      <label for="lab-camera-doc" class="flex flex-col">
        <span class="sr-only">{{ $t("palette-camera-doc") }}</span>
        <input
          id="lab-camera-doc"
          v-model="doc"
          :class="select"
          :placeholder="$t('palette-camera-doc-hint')"
          data-testid="lab-camera-doc"
        />
      </label>
      <label for="lab-camera-replace" class="flex items-center gap-2">
        <input id="lab-camera-replace" v-model="replace" type="checkbox" />
        <span>{{ $t("palette-camera-replace") }}</span>
      </label>
      <div class="flex gap-2">
        <button type="submit" :class="cn(button, 'min-h-9 px-3')" data-testid="lab-camera-save-dry">
          {{ $t("palette-camera-save") }}
        </button>
        <button
          type="button"
          :class="cn(button, 'min-h-9 px-3')"
          data-testid="lab-camera-bookmark"
          @click="run('camera.bookmark', { name: name.trim() })"
        >
          {{ $t("palette-camera-bookmark") }}
        </button>
      </div>
    </form>
    <p class="text-text-secondary">{{ $t("palette-camera-help") }}</p>
    <p v-if="status !== null" class="text-status-critical" data-testid="lab-camera-status">{{ status }}</p>
    <div v-if="result !== null" class="flex flex-col gap-1" data-testid="lab-camera-result">
      <p>
        {{ $t("palette-camera-result", { name: result.name, dry: selectKey(result.dry) }) }}
        <span class="font-mono" translate="no">{{ result.status }}</span>
      </p>
      <template v-if="result.status === 'copy'">
        <p class="text-text-secondary">{{ $t("palette-camera-no-workbench") }}</p>
        <p class="font-mono break-all select-all" translate="no" data-testid="lab-camera-command">
          {{ result.command }}
        </p>
        <button type="button" :class="cn(button, 'self-start')" @click="copy(result.command)">
          {{ $t("palette-camera-copy") }}
        </button>
      </template>
      <pre v-else-if="result.output !== ''" class="max-h-40 overflow-auto font-mono text-caption whitespace-pre-wrap">{{
        result.output
      }}</pre>
      <button
        v-if="result.dry && result.status === 'passed'"
        type="button"
        :class="cn(button, 'self-start')"
        data-testid="lab-camera-write"
        @click="write"
      >
        {{ $t("palette-camera-write", { name: result.name }) }}
      </button>
    </div>
    <div v-if="bookmarks.length > 0" class="flex flex-wrap gap-1.5" data-testid="lab-camera-bookmarks">
      <button
        v-for="item in bookmarks"
        :key="item.name"
        type="button"
        :class="button"
        :title="$t('palette-camera-open-bookmark', { name: item.name })"
        @click="run('camera.recall', { name: item.name })"
      >
        <span translate="no">{{ item.name }}</span>
      </button>
    </div>
  </section>
</template>
