<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Learn in the Hub: the samples, the docs and what is new. Each sample opens as a copy through the new project
 * wizard, thus a sample never changes. The prompt box answers a question with the docs and the tutorials.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ExternalLink } from "lucide-vue-next";
import AskBox from "./AskBox.vue";
import { DOCS_URL } from "./docsSearch";
import type { ProjectInfo } from "./studioApi";
import { HUB_TEMPLATES } from "./templates";

defineProps<{
  projects: readonly ProjectInfo[];
  /** Open a project folder. The result is the URL of its editor window, or null. */
  open: (dir: string) => Promise<string | null>;
}>();
const emit = defineEmits<{ copy: [template: string] }>();
const { $t } = useI18n();
const docs = [
  { id: "studio", file: "studio.md" },
  { id: "quickstart", file: "quickstart.md" },
  { id: "editor", file: "editor.md" },
  { id: "formats", file: "formats.md" },
  { id: "plugins", file: "plugins.md" },
  { id: "cli", file: "cli.md" },
];
const samples = HUB_TEMPLATES.filter((item) => item.id !== "empty");
</script>

<template>
  <div class="flex flex-col gap-8" data-testid="hub-learn">
    <AskBox :projects="projects" :open="open" />
    <section class="flex flex-col gap-3">
      <h2 class="text-subtitle">{{ $t("hub-learn-samples") }}</h2>
      <p class="text-text-secondary">{{ $t("hub-learn-samples-body") }}</p>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
        <li
          v-for="item in samples"
          :key="item.id"
          class="flex flex-col overflow-hidden rounded-card border border-border-subtle bg-surface-raised"
        >
          <div class="aspect-video bg-surface-sunken">
            <img
              v-if="item.picture !== null"
              :src="item.picture"
              alt=""
              class="size-full object-cover"
              loading="lazy"
            />
          </div>
          <div class="flex flex-1 flex-col gap-2 p-3">
            <h3 class="font-semibold">{{ $t(`hub-template-${item.text}`) }}</h3>
            <p class="flex-1 text-caption text-text-secondary">{{ $t(`hub-template-${item.text}-about`) }}</p>
            <Button size="sm" :data-sample="item.id" @click="emit('copy', item.id)">{{ $t("hub-learn-copy") }}</Button>
          </div>
        </li>
      </ul>
    </section>
    <section class="flex flex-col gap-3">
      <h2 class="text-subtitle">{{ $t("hub-learn-docs") }}</h2>
      <ul class="flex flex-wrap gap-2">
        <li v-for="doc in docs" :key="doc.id">
          <a
            :href="`${DOCS_URL}${doc.file}`"
            target="_blank"
            rel="noreferrer"
            class="flex min-h-10 items-center gap-2 rounded-control border border-border-subtle px-3 text-label hover:bg-surface-raised"
          >
            {{ $t(`hub-doc-${doc.id}`) }}<ExternalLink class="size-icon-sm" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </section>
    <!-- The tutorials run in the editor window (Help → Tutorials). -->
    <section class="flex flex-col gap-2" data-testid="hub-learn-tutorials">
      <h2 class="text-subtitle">{{ $t("hub-learn-tutorials") }}</h2>
      <p class="max-w-prose text-text-secondary">{{ $t("hub-learn-tutorials-body") }}</p>
    </section>
    <section class="flex flex-col gap-2">
      <h2 class="text-subtitle">{{ $t("hub-learn-new") }}</h2>
      <p class="max-w-prose text-text-secondary">{{ $t("hub-learn-new-body") }}</p>
    </section>
  </div>
</template>
