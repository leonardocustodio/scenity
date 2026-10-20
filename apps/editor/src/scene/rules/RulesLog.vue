<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rules log of the Rules panel: each override of the scene (rulesLog.ts) with its time, its reason, the failed
 * rules and the hash of the scene. An override with the current hash of the file counts ("current"). An older one does
 * not. The panel reads the log at the start and after each save.
 */
import { useI18n } from "@scenity/i18n";
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { ScenePageEditor } from "../sceneEditor";
import { parseRulesLog, rulesLogPath, type LoggedOverride } from "./rulesLog";

const props = defineProps<{ editor: ScenePageEditor; base: string }>();
const { $t } = useI18n();
const entries = shallowRef<readonly LoggedOverride[]>([]);
const hash = shallowRef<string | null>(null);

async function read(): Promise<void> {
  const response = await fetch(`${props.base}${rulesLogPath(props.editor.file.path)}`, { cache: "no-store" }).catch(
    () => null,
  );
  const type = response?.headers.get("content-type") ?? "";
  // A static host answers a missing file with the page: only a text answer is a log.
  entries.value = response?.ok === true && !type.includes("html") ? parseRulesLog(await response.text()) : [];
  hash.value = props.editor.file.baseHash;
}
let stop: (() => void) | undefined;
onMounted(() => {
  void read();
  stop = props.editor.listenSaved(() => void read());
});
onBeforeUnmount(() => stop?.());
</script>

<template>
  <section class="flex flex-col gap-1 text-caption" :aria-label="$t('rules-log')" data-testid="rules-log">
    <h3 class="font-medium">{{ $t("rules-log") }}</h3>
    <p v-if="entries.length === 0" class="text-text-secondary">{{ $t("rules-log-none") }}</p>
    <ul class="flex flex-col gap-1">
      <li
        v-for="entry in entries"
        :key="`${entry.time}:${entry.hash}`"
        class="flex flex-col rounded-control border border-border-subtle p-1"
        :data-current="entry.hash === hash ? '1' : '0'"
        data-testid="rules-log-entry"
      >
        <span class="flex gap-2">
          <span class="text-text-secondary" translate="no">{{ entry.time.replace("T", " ").slice(0, 19) }}</span>
          <span :class="entry.hash === hash ? 'text-status-caution' : 'text-text-secondary'">
            {{ entry.hash === hash ? $t("rules-log-current") : $t("rules-log-old") }}
          </span>
          <span
            class="ml-auto font-mono text-text-secondary"
            translate="no"
            :title="entry.hash"
            data-testid="rules-log-hash"
          >
            {{ entry.hash.slice(0, 12) }}
          </span>
        </span>
        <span data-testid="rules-log-reason" translate="no">{{ entry.reason }}</span>
        <span class="text-text-secondary" translate="no">
          {{ entry.rules.map((rule) => `${rule.id} (${rule.status})`).join(", ") }}
        </span>
      </li>
    </ul>
  </section>
</template>
