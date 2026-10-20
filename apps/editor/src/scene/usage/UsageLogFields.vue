<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The usage log in Preferences: the count of its lines, Download (a file of JSON lines for a
 * usability study) and Clear. The switch is the setting "Usage log" of the editor settings. The log stays in this
 * browser.
 */
import { useI18n } from "@scenity/i18n";
import { ref } from "vue";
import { clearUsage, usageFile, usageLines } from "./usageLog";

const { $t } = useI18n();
const count = ref(usageLines().length);
const button = "rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised disabled:opacity-50";

function download(): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([usageFile()], { type: "application/x-ndjson" }));
  link.download = "scenity-usage.jsonl";
  link.click();
  URL.revokeObjectURL(link.href);
}
function clear(): void {
  clearUsage();
  count.value = 0;
}
</script>

<template>
  <section class="flex flex-col gap-1" :aria-label="$t('usage-title')" data-testid="settings-usage">
    <h4 class="font-medium">{{ $t("usage-title") }}</h4>
    <p class="text-text-secondary">{{ $t("usage-hint") }}</p>
    <div class="flex items-center gap-1">
      <span data-testid="usage-count">{{ $t("usage-count", { count }) }}</span>
      <button type="button" :class="button" @click="count = usageLines().length">{{ $t("pool-refresh") }}</button>
      <button type="button" :class="button" :disabled="count === 0" data-testid="usage-download" @click="download">
        {{ $t("usage-download") }}
      </button>
      <button type="button" :class="button" :disabled="count === 0" data-testid="usage-clear" @click="clear">
        {{ $t("usage-clear") }}
      </button>
    </div>
  </section>
</template>
