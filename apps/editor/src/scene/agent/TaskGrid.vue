<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The grid of frames of a group of parallel tasks. For each task, it shows the view camera after the change sets of
 * its session, its name in its colour and the count of the ops that wait. The pictures arrive one at a time (the core
 * draws one preview at a time). "Keep" keeps one task: it accepts its changes and rejects the changes of the other
 * tasks. "Merge" keeps the changes of each task (a split group).
 */
import { onMounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import type { TaskGroupView } from "./taskGroups";

const props = defineProps<{
  group: TaskGroupView;
  /** A picture of the view after the change sets of a session, or null. */
  picture(session: string): Promise<ImageBitmap | null>;
  /** The count of the ops that wait in Review for the change sets of a task. */
  waiting(sets: readonly string[]): number;
  keep(session: string): void;
  merge(): void;
  close(): void;
}>();
const { $t } = useI18n();

const canvases = ref<Record<string, HTMLCanvasElement | null>>({});
const missing = ref<ReadonlySet<string>>(new Set());
const loading = ref(true);

onMounted(async () => {
  for (const task of props.group.tasks) {
    const image = await props.picture(task.session);
    const canvas = canvases.value[task.session] ?? null;
    if (image === null || canvas === null) {
      missing.value = new Set([...missing.value, task.session]);
      continue;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
  }
  loading.value = false;
});

const colour = (token: string): Record<string, string> => ({ background: `var(--sc-color-studio-${token})` });
</script>

<template>
  <section
    class="flex flex-col gap-2 rounded-control border border-border-strong p-2"
    :aria-label="$t('task-grid', { count: group.tasks.length })"
    :data-loading="loading ? '1' : '0'"
    :data-group="group.id"
    data-testid="task-grid"
  >
    <div class="flex items-center gap-2">
      <strong class="min-w-0 flex-1 truncate">{{
        $t(`task-grid-${group.kind}`, { count: group.tasks.length })
      }}</strong>
      <Button v-if="group.kind === 'split'" size="sm" variant="primary" data-testid="task-grid-merge" @click="merge()">
        {{ $t("task-grid-merge") }}
      </Button>
      <Button size="sm" variant="ghost" data-testid="task-grid-close" @click="close()">
        {{ $t("task-grid-close") }}
      </Button>
    </div>
    <ul class="grid grid-cols-2 gap-2" :aria-label="$t('task-grid-frames')">
      <li
        v-for="task in group.tasks"
        :key="task.id"
        class="flex flex-col gap-1"
        :data-session="task.session"
        data-testid="task-grid-cell"
      >
        <canvas
          :ref="(element) => (canvases[task.session] = element as HTMLCanvasElement | null)"
          class="block w-full rounded-control bg-surface-sunken"
          :aria-label="$t('task-grid-frame', { name: task.name })"
          role="img"
          data-testid="task-grid-frame"
        />
        <p v-if="missing.has(task.session)" class="text-text-secondary">{{ $t("task-grid-no-picture") }}</p>
        <div class="flex items-center gap-1">
          <span class="size-2 flex-none rounded-full" :style="colour(task.colour)" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ task.name }}</span>
          <span class="text-text-secondary">{{ $t("tasks-waiting", { count: waiting(task.sets) }) }}</span>
        </div>
        <Button
          v-if="group.kind === 'variants'"
          size="sm"
          variant="primary"
          :disabled="loading || waiting(task.sets) === 0"
          data-testid="task-grid-keep"
          @click="keep(task.session)"
        >
          {{ $t("task-grid-keep") }}
        </Button>
      </li>
    </ul>
  </section>
</template>
