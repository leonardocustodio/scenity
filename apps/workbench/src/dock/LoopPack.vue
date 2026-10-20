<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The review pack of a background run: `REVIEW.md` of the run of `labs review <take>
 * --ref <start head>` with its images, as the Review tab shows a pack.
 */
import type { LoopReview } from "@scenity/workbench-host/protocol";
import { computed, ref, watch } from "vue";
import MarkdownView from "./MarkdownView";
import { parseMarkdown, resolveImage } from "./markdown";
import type { RunFiles } from "./runFile";

defineOptions({ name: "DockLoopPack" });
const props = defineProps<{
  readonly review: LoopReview;
  readonly files: RunFiles;
}>();

const text = ref("");
const error = ref<string | null>(null);
const blocks = computed(() => parseMarkdown(text.value));

watch(
  () => [props.review.run, props.review.status] as const,
  async ([run, status]) => {
    text.value = "";
    error.value = null;
    if (status !== "passed") return;
    try {
      text.value = await props.files.text(run, "REVIEW.md");
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  },
  { immediate: true },
);

function image(src: string): string | null {
  const folder = props.review.outDir;
  return folder === null ? null : props.files.url(props.review.run, resolveImage(folder, src));
}
</script>

<template>
  <section class="flex min-h-0 flex-col gap-1" aria-label="Review pack of the run" data-testid="loop-pack">
    <p class="truncate text-caption text-text-secondary">
      Review pack ({{ review.status }}): <code class="font-mono">{{ review.outDir ?? "no folder" }}</code>
    </p>
    <p v-if="error !== null" class="text-caption text-status-negative" role="alert">{{ error }}</p>
    <div class="min-h-0 flex-1 overflow-auto">
      <MarkdownView v-if="text !== ''" :blocks="blocks" :image="image" />
    </div>
  </section>
</template>
