<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Scenes panel: the start screen of the project in the dock. The scenes of the project with their pictures (the
 * poster, else a still), a mark for the open scenes and for unsaved changes, the recent scenes, and New scene. A click
 * opens the scene in a tab.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import type { ProjectSceneFile } from "../sceneFiles";
import type { OpenSceneInfo, PageScenes } from "./pageScenes";
import { sceneName } from "./sceneTabs";
import EmptyState from "../../studio/shell/EmptyState.vue";

const props = defineProps<{
  scenes: PageScenes;
  /** The folder of the project on the dev server (`/projects/<key>/`), for the pictures. */
  base: string;
  newScene(): void;
}>();
const { $t } = useI18n();

const files = shallowRef<readonly ProjectSceneFile[]>([]);
const open = shallowRef<readonly OpenSceneInfo[]>(props.scenes.list());
const recent = ref<readonly string[]>(props.scenes.recent.list());
const loaded = ref(false);

async function reload(): Promise<void> {
  open.value = props.scenes.list();
  recent.value = props.scenes.recent.list();
  files.value = (await props.scenes.projectScenes())?.files ?? [];
  loaded.value = true;
}

let stop: (() => void) | null = null;
onMounted(() => {
  stop = props.scenes.listen(() => void reload());
  void reload();
});
onBeforeUnmount(() => stop?.());

const state = (path: string): OpenSceneInfo | undefined => open.value.find((item) => item.path === path);
const others = computed(() => recent.value.filter((path) => !files.value.some((file) => file.path === path)));
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption"
    :aria-label="$t('panel-scenes')"
    :data-ready="loaded ? '1' : undefined"
    data-testid="scenes-panel"
  >
    <div class="flex items-center gap-2">
      <h3 class="flex-1 text-label">{{ $t("scenes-panel-project") }}</h3>
      <Button size="sm" variant="secondary" data-testid="scenes-new" @click="newScene()">
        {{ $t("projects-menu-new") }}
      </Button>
    </div>
    <EmptyState v-if="loaded && files.length === 0" panel="scenes" :text="$t('scenes-panel-none')" />
    <ul class="grid grid-cols-2 gap-2">
      <li v-for="file in files" :key="file.path" :data-path="file.path" data-testid="scenes-card">
        <button
          type="button"
          class="flex w-full flex-col gap-1 rounded-control border border-border-subtle p-1 text-left hover:bg-surface-sunken"
          :class="{ 'border-border-strong': state(file.path)?.active === true }"
          :aria-current="state(file.path)?.active === true ? 'page' : undefined"
          @click="scenes.open(file.path)"
        >
          <span class="flex aspect-video items-center justify-center overflow-hidden rounded-control bg-surface-sunken">
            <img v-if="file.picture !== null" :src="`${base}${file.picture}`" alt="" loading="lazy" class="w-full" />
            <span v-else class="text-text-secondary">{{ $t("projects-no-picture") }}</span>
          </span>
          <strong class="truncate" translate="no">{{ file.name ?? sceneName(file.path) }}</strong>
          <span class="truncate text-text-secondary" translate="no">{{ file.path }}</span>
          <span v-if="state(file.path) !== undefined" class="text-text-secondary" data-testid="scenes-open-mark">
            {{ state(file.path)?.dirty === true ? $t("scenes-panel-unsaved") : $t("scenes-panel-open") }}
          </span>
        </button>
      </li>
    </ul>
    <template v-if="others.length > 0">
      <h3 class="text-label">{{ $t("scenes-panel-recent") }}</h3>
      <ul>
        <li v-for="path in others" :key="path">
          <button type="button" class="truncate hover:underline" translate="no" @click="scenes.open(path)">
            {{ path }}
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>
