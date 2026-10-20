<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Instructions panel: `AGENTS.md` of the project in a field (Save writes it), `CLAUDE.md` to read, and the skills
 * of `.scenity/skills/`. Each turn of an agent session reads them at its start.
 */
import { onMounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import type { AgentClient, ProjectInstructions } from "./agentClient";

const props = defineProps<{ client: Pick<AgentClient, "instructions" | "saveInstructions">; project: string }>();
const { $t } = useI18n();
const loaded = ref<ProjectInstructions | null>(null);
const text = ref("");
const state = ref<"idle" | "saved" | "failed">("idle");

async function load(): Promise<void> {
  loaded.value = await props.client.instructions(props.project);
  text.value = loaded.value.agents ?? "";
}

async function save(): Promise<void> {
  try {
    loaded.value = await props.client.saveInstructions(props.project, text.value);
    state.value = "saved";
  } catch {
    state.value = "failed";
  }
}

onMounted(() => void load().catch(() => (state.value = "failed")));
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption" data-testid="instructions-panel">
    <p class="text-text-secondary">{{ $t("instructions-body") }}</p>
    <textarea
      v-model="text"
      rows="10"
      class="w-full resize-y rounded-control border border-border-strong bg-surface-raised p-2 font-mono text-body"
      :aria-label="$t('instructions-agents')"
      :placeholder="$t('instructions-placeholder')"
      data-testid="instructions-agents"
      @input="state = 'idle'"
    />
    <div class="flex items-center gap-2">
      <Button size="sm" variant="primary" data-testid="instructions-save" @click="save">{{
        $t("instructions-save")
      }}</Button>
      <span v-if="state === 'saved'" class="text-text-secondary" data-testid="instructions-saved">
        {{ $t("instructions-saved") }}
      </span>
      <span v-if="state === 'failed'" class="text-status-negative" role="alert">{{ $t("instructions-failed") }}</span>
    </div>
    <details v-if="loaded?.claude !== null && loaded?.claude !== undefined" data-testid="instructions-claude">
      <summary class="cursor-default">{{ $t("instructions-claude") }}</summary>
      <pre class="overflow-auto whitespace-pre-wrap text-text-secondary" translate="no">{{ loaded.claude }}</pre>
    </details>
    <h3 class="text-label">{{ $t("instructions-skills") }}</h3>
    <p v-if="(loaded?.skills.length ?? 0) === 0" class="text-text-secondary">{{ $t("instructions-no-skills") }}</p>
    <ul v-else :aria-label="$t('instructions-skills')">
      <li v-for="skill in loaded?.skills ?? []" :key="skill.file" data-testid="instructions-skill">
        <strong>{{ skill.name }}</strong> <span class="text-text-secondary">{{ skill.use }}</span>
      </li>
    </ul>
  </section>
</template>
