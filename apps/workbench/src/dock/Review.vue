<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Review tab: `labs review <take>` against the commit at the session start (the host adds `--ref`). Then the tab
 * shows `REVIEW.md` of the pack with its images, and the path of the folder with a copy button. The pack shows without
 * a file manager.
 */
import { computed, ref, watch } from "vue";
import { button, field } from "../layout/ui";
import { useDefaultSequence } from "./defaultSequence";
import MarkdownView from "./MarkdownView";
import { parseMarkdown, resolveImage } from "./markdown";
import type { RunFiles } from "./runFile";
import type { RunsApi } from "./useRuns";

defineOptions({ name: "DockReview" });
const props = defineProps<{
  readonly runs: RunsApi;
  readonly files: RunFiles;
  /** The commit at the session start, or null. */
  readonly start: string | null;
  /** The default sequence of the project, or null. */
  readonly defaultSequence?: string | null;
}>();

const take = ref("");
useDefaultSequence(take, () => props.defaultSequence);
const chosen = ref<string | null>(null);
const text = ref("");
const error = ref<string | null>(null);
const copied = ref(false);

const reviews = computed(() => props.runs.runs.value.filter((run) => run.command === "review"));
const current = computed(() => reviews.value.find((run) => run.run === chosen.value) ?? reviews.value[0] ?? null);
const folder = computed(() => current.value?.outDir ?? null);
const blocks = computed(() => parseMarkdown(text.value));

watch(
  () => [current.value?.run, current.value?.status] as const,
  async ([run, status]) => {
    text.value = "";
    error.value = null;
    if (run === undefined || status !== "passed" || folder.value === null) return;
    try {
      text.value = await props.files.text(run, "REVIEW.md");
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  },
  { immediate: true },
);

function image(src: string): string | null {
  const run = current.value;
  if (run === null || folder.value === null) return null;
  return props.files.url(run.run, resolveImage(folder.value, src));
}

async function make(): Promise<void> {
  const run = await props.runs.start("review", [take.value.trim()]);
  if (run !== null) chosen.value = run;
}

async function copy(): Promise<void> {
  if (folder.value === null) return;
  try {
    await globalThis.navigator.clipboard.writeText(folder.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    error.value = "The clipboard is not available; select the path by hand.";
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" data-testid="dock-review-tab">
    <form class="flex flex-wrap items-center gap-1" @submit.prevent="make">
      <input v-model="take" :class="[field, 'w-40']" aria-label="Take of the review pack" placeholder="take" />
      <button type="submit" :class="button" :disabled="take.trim() === ''">Make review pack</button>
      <span class="text-caption text-text-secondary">
        against {{ start === null ? "HEAD" : start.slice(0, 10) }} (the session start)
      </span>
      <select
        v-if="reviews.length > 1"
        :value="current?.run"
        :class="[field, 'ml-auto w-56']"
        aria-label="Review pack"
        @change="chosen = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="run in reviews" :key="run.run" :value="run.run">{{ run.args[0] }} · {{ run.started }}</option>
      </select>
    </form>
    <p v-if="current === null" class="text-caption text-text-secondary">No review pack in this host yet.</p>
    <template v-else>
      <p v-if="folder !== null" class="flex items-center gap-2 text-caption">
        <code class="truncate font-mono" data-testid="review-folder">{{ folder }}</code>
        <button type="button" :class="button" @click="copy">{{ copied ? "Copied" : "Copy path" }}</button>
      </p>
      <p v-if="current.status === 'running'" class="text-caption text-status-caution" role="status">
        The review pack is in progress. The Runs tab shows its output.
      </p>
      <p v-else-if="current.status !== 'passed'" class="text-caption text-status-negative" role="alert">
        The review run {{ current.status }}. {{ current.summary }}
      </p>
      <p v-if="error !== null" class="text-caption text-status-negative" role="alert">{{ error }}</p>
      <div class="min-h-0 flex-1 overflow-auto">
        <MarkdownView v-if="text !== ''" :blocks="blocks" :image="image" />
      </div>
    </template>
  </div>
</template>
