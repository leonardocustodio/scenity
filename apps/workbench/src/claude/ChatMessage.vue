<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One entry of the chat transcript. An entry is one of these:
 * - a prompt of the owner;
 * - a text of Claude (simple Markdown, which the page shows as Vue nodes, never as HTML);
 * - a folded thinking text;
 * - a tool call with its input folded and its result with the pictures inline;
 * - the cost line of a result, or the init line.
 * A picture is an ID of the host. PictureImg.vue shows it as an object URL.
 */
import { computed } from "vue";
import MarkdownView from "../dock/MarkdownView";
import { parseMarkdown } from "../dock/markdown";
import PictureImg from "../layout/PictureImg.vue";
import { cn } from "../layout/ui";
import { inputSummary } from "./approval";
import { costText, type ChatEntry } from "./transcript";

const props = defineProps<{ readonly entry: ChatEntry }>();

const blocks = computed(() => (props.entry.kind === "text" ? parseMarkdown(props.entry.text) : []));
const noImage = (): null => null;
const toolName = computed(() =>
  props.entry.kind === "tool" ? props.entry.name.replace(/^mcp__workbench__/, "workbench · ") : "",
);
const inputText = computed(() => (props.entry.kind === "tool" ? JSON.stringify(props.entry.input ?? {}, null, 2) : ""));
const RESULT_WORDS: Readonly<Record<string, string>> = {
  success: "Done",
  error_max_turns: "Stopped: the turn limit",
  error_max_budget_usd: "Stopped: the budget",
  error_during_execution: "Stopped",
};
</script>

<template>
  <div
    v-if="entry.kind === 'prompt'"
    class="self-end rounded-control bg-surface-sunken px-2 py-1.5 whitespace-pre-wrap"
    data-testid="chat-prompt"
  >
    {{ entry.text }}
  </div>
  <MarkdownView v-else-if="entry.kind === 'text'" :blocks="blocks" :image="noImage" data-testid="chat-text" />
  <details v-else-if="entry.kind === 'thinking'" class="text-caption text-text-secondary">
    <summary class="cursor-pointer">Thinking</summary>
    <p class="mt-1 whitespace-pre-wrap">{{ entry.text }}</p>
  </details>
  <div
    v-else-if="entry.kind === 'tool'"
    class="flex flex-col gap-1 rounded-control border border-border-subtle p-1.5 text-caption"
    data-testid="chat-tool"
  >
    <details>
      <summary class="flex cursor-pointer gap-1.5">
        <span class="font-mono text-text-primary">{{ toolName }}</span>
        <span class="truncate text-text-secondary">{{ inputSummary(entry.name, entry.input) }}</span>
      </summary>
      <pre class="mt-1 max-h-60 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono">{{ inputText }}</pre>
    </details>
    <template v-if="entry.outcome !== null">
      <details v-if="entry.outcome.texts.length > 0" :open="entry.outcome.isError">
        <summary :class="cn('cursor-pointer', entry.outcome.isError ? 'text-status-negative' : 'text-text-secondary')">
          {{ entry.outcome.isError ? "Error" : "Result" }}
        </summary>
        <pre class="mt-1 max-h-60 overflow-auto font-mono whitespace-pre-wrap">{{
          entry.outcome.texts.join("\n")
        }}</pre>
      </details>
      <PictureImg
        v-for="(image, index) in entry.outcome.images"
        :key="`${index}:${image.picture}`"
        :picture="image.picture"
        :alt="`Picture ${index + 1} of ${toolName}`"
        class="max-w-full rounded-control border border-border-subtle"
        data-testid="chat-tool-image"
      />
    </template>
    <span v-else class="text-text-secondary">Running…</span>
  </div>
  <p
    v-else-if="entry.kind === 'result'"
    :class="cn('text-caption', entry.subtype === 'success' ? 'text-text-secondary' : 'text-status-caution')"
    data-testid="chat-result"
  >
    {{ RESULT_WORDS[entry.subtype] ?? entry.subtype }} · {{ (entry.durationMs / 1000).toFixed(1) }} s ·
    {{ entry.numTurns }} requests · session {{ costText(entry.costUsd) }}
    <span v-if="entry.errors.length > 0" class="block">{{ entry.errors.join("; ") }}</span>
  </p>
  <p v-else class="text-caption text-text-secondary" data-testid="chat-system">{{ entry.text }}</p>
</template>
