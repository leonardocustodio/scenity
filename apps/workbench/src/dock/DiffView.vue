<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The diff view of the Changes tab: a unified diff per file, with the colors of the
 * status tokens (added lines positive, removed lines negative).
 */
import { computed } from "vue";
import { cn } from "../layout/ui";
import { parseDiff, type DiffLineKind } from "./diff";

const props = defineProps<{ readonly patch: string }>();
const files = computed(() => parseDiff(props.patch));

const LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  add: "bg-status-positive-subtle text-status-positive",
  del: "bg-status-negative-subtle text-status-negative",
  hunk: "text-status-info",
  context: "text-text-primary",
  meta: "text-text-secondary",
};
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="diff-view">
    <p v-if="files.length === 0" class="text-caption text-text-secondary">No change.</p>
    <section v-for="file in files" :key="file.path" class="rounded-control border border-border-subtle">
      <h3 class="flex gap-2 border-b border-border-subtle px-2 py-1 font-mono text-caption">
        <span class="truncate">{{ file.path }}</span>
        <span class="ml-auto text-status-positive">+{{ file.added }}</span>
        <span class="text-status-negative">−{{ file.removed }}</span>
      </h3>
      <pre class="overflow-x-auto font-mono text-caption"><code><span
        v-for="(line, index) in file.lines"
        :key="index"
        :class="cn('block px-2', LINE_CLASS[line.kind])"
        :data-kind="line.kind"
      >{{ line.text === '' ? ' ' : line.text }}</span></code></pre>
    </section>
  </div>
</template>
