<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Hub prompt box: the person asks how to do something, and the answer links to the sections of the docs and to a
 * tutorial (`docsSearch.ts`). A tutorial starts in the last project of the person. The editor window opens with
 * `tutorial=<id>` and runs that tutorial one time.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ExternalLink, GraduationCap } from "lucide-vue-next";
import { computed, ref } from "vue";
import { messageIdOf } from "../texts";
import { TUTORIALS } from "../scene/tutorials/tutorials";
import { loadDocsIndex, searchDocs, searchTutorials, type DocAnswer } from "./docsSearch";
import type { ProjectInfo } from "./studioApi";

const props = defineProps<{
  projects: readonly ProjectInfo[];
  /** Open a project folder. The result is the URL of its editor window, or null. */
  open: (dir: string) => Promise<string | null>;
}>();
const { $t } = useI18n();
const question = ref("");
const asked = ref<{ docs: DocAnswer[]; tutorials: string[] } | null>(null);
const last = computed(
  () =>
    [...props.projects]
      .filter((project) => project.exists)
      .sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))[0] ?? null,
);

/** The texts of a tutorial in the page language. */
const textOf = (id: string, part: string): string => $t(`${messageIdOf("tutorial", id)}-${part}`);

async function ask(): Promise<void> {
  const text = question.value.trim();
  if (text === "") return;
  const index = await loadDocsIndex();
  const tutorials = TUTORIALS.map((tutorial) => ({
    id: tutorial.id,
    title: textOf(tutorial.id, "title"),
    steps: tutorial.steps.map((step) => textOf(tutorial.id, step.id)),
  }));
  asked.value = { docs: searchDocs(index, text), tutorials: searchTutorials(index, text, tutorials) };
}

async function start(tutorial: string): Promise<void> {
  if (last.value === null) return;
  const url = await props.open(last.value.dir);
  if (url === null) return;
  const next = new URL(url, location.href);
  next.searchParams.set("tutorial", tutorial);
  location.assign(next);
}
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="hub-ask">
    <h2 class="text-subtitle">{{ $t("hub-ask-title") }}</h2>
    <form class="flex flex-wrap gap-2" @submit.prevent="ask">
      <input
        v-model="question"
        type="search"
        :aria-label="$t('hub-ask-title')"
        :placeholder="$t('hub-ask-placeholder')"
        class="min-h-10 min-w-64 flex-1 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
        data-testid="hub-ask-input"
      />
      <Button type="submit" data-testid="hub-ask-go">{{ $t("hub-ask-go") }}</Button>
    </form>
    <div v-if="asked !== null" class="flex flex-col gap-2" aria-live="polite" data-testid="hub-ask-answers">
      <p v-if="asked.docs.length === 0 && asked.tutorials.length === 0" class="text-text-secondary">
        {{ $t("hub-ask-none") }}
      </p>
      <div
        v-for="id in asked.tutorials"
        :key="id"
        class="flex flex-wrap items-center gap-3 rounded-card border border-border-subtle bg-surface-raised p-3"
        :data-tutorial="id"
        data-testid="hub-ask-tutorial"
      >
        <GraduationCap class="size-icon text-text-secondary" aria-hidden="true" />
        <div class="flex min-w-48 flex-1 flex-col">
          <span class="font-semibold">{{ $t("hub-ask-tutorial", { title: textOf(id, "title") }) }}</span>
          <span v-if="last === null" class="text-caption text-text-secondary">{{ $t("hub-ask-tutorial-open") }}</span>
        </div>
        <Button v-if="last !== null" size="sm" data-testid="hub-ask-start" @click="start(id)">
          {{ $t("hub-ask-start", { project: last.name }) }}
        </Button>
      </div>
      <ul class="flex flex-col gap-2">
        <li v-for="answer in asked.docs" :key="answer.url">
          <a
            :href="answer.url"
            target="_blank"
            rel="noreferrer"
            class="flex flex-col gap-1 rounded-card border border-border-subtle p-3 hover:bg-surface-raised"
            data-testid="hub-ask-doc"
          >
            <span class="flex items-center gap-2 font-semibold">
              {{ [...answer.section.parents.slice(0, 1), answer.section.heading].join(" › ") }}
              <ExternalLink class="size-icon-sm" aria-hidden="true" />
            </span>
            <span class="text-caption text-text-secondary">{{ answer.excerpt }}</span>
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>
