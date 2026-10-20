<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The agent panel with no agent. The studio runs with no agent sessions, and all the other features work without
 * them. The panel tells how to connect an agent.
 */
import { useI18n } from "@scenity/i18n";
import { Bot } from "lucide-vue-next";

const { $t } = useI18n();
</script>

<template>
  <section class="flex h-full flex-col gap-2 p-3 text-caption" data-testid="agent-none" :aria-label="$t('panel-agent')">
    <Bot class="size-icon-lg text-text-secondary" aria-hidden="true" />
    <h2 class="text-label">{{ $t("agent-none-title") }}</h2>
    <p>{{ $t("agent-none-body") }}</p>
    <ul class="list-disc pl-4 text-text-secondary">
      <li>{{ $t("agent-none-claude") }}</li>
      <li>{{ $t("agent-none-key") }}</li>
      <li>{{ $t("agent-none-external") }}</li>
    </ul>
  </section>
</template>
