<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The release check panel: Run the release check (`assets release-check` on the dev server),
 * the result of the gate, and the findings of each asset. Each finding links to its fix (releaseFixes.ts): the panel
 * that fixes it, and the asset in the asset browser.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, ref, shallowRef } from "vue";
import type { AssetSource } from "../assetClient";
import { showAsset } from "../assetFocus";
import type { ReleaseRunResult } from "../assetTypes";
import { releaseFix, releaseGroups } from "./releaseFixes";

const props = defineProps<{ source: AssetSource; open: (panel: string) => void }>();
const { $t } = useI18n();
const result = shallowRef<ReleaseRunResult | null>(null);
const names = shallowRef<ReadonlyMap<string, string>>(new Map());
const running = ref(false);

async function run(): Promise<void> {
  if (props.source.releaseCheck === undefined) return;
  running.value = true;
  const [report, list] = await Promise.all([props.source.releaseCheck(), props.source.list().catch(() => null)]);
  names.value = new Map((list?.assets ?? []).map((asset) => [asset.id, asset.name]));
  result.value = report;
  running.value = false;
}

const groups = computed(() => (result.value?.ok === true ? releaseGroups(result.value.findings) : []));
const nameOf = (id: string): string => names.value.get(id) ?? id;

function fix(panel: string, id: string | null): void {
  props.open(panel);
  if (id !== null && panel === "project") showAsset(id, nameOf(id));
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col text-caption text-text-primary"
    :aria-label="$t('release-panel')"
    data-testid="release-panel"
  >
    <header class="flex flex-wrap items-center gap-2 border-b border-border-subtle px-1.5 py-1">
      <Button
        size="sm"
        variant="primary"
        :disabled="running || source.releaseCheck === undefined"
        data-testid="release-run"
        @click="run"
      >
        {{ running ? $t("release-running") : $t("release-run") }}
      </Button>
      <span
        v-if="result?.ok === true"
        :class="result.passed ? 'text-status-positive' : 'text-status-negative'"
        data-testid="release-result"
        :data-passed="result.passed ? '1' : '0'"
      >
        {{
          result.passed
            ? $t("release-passed", { count: result.assets })
            : $t("release-failed", {
                count: result.assets,
                errors: result.findings.filter((f) => f.level === "error").length,
              })
        }}
      </span>
      <span v-else-if="result?.ok === false" class="text-status-negative" role="alert">{{ result.reason }}</span>
    </header>
    <ul class="min-h-0 flex-1 overflow-auto p-1.5" :aria-label="$t('release-findings')">
      <li
        v-for="group in groups"
        :key="group.id ?? '*project'"
        class="mb-1.5"
        :data-asset="group.id ?? undefined"
        data-testid="release-group"
      >
        <h3 class="flex items-center gap-2 font-medium">
          <span translate="no">{{ group.id === null ? $t("release-project") : nameOf(group.id) }}</span>
          <Button
            v-if="group.id !== null"
            size="sm"
            variant="ghost"
            :data-testid="`release-show-${group.id}`"
            @click="fix('project', group.id)"
          >
            {{ $t("release-fix-asset") }}
          </Button>
        </h3>
        <ul class="flex flex-col gap-0.5 pl-2">
          <li
            v-for="finding in group.findings"
            :key="`${finding.check}:${finding.message}`"
            class="flex items-start gap-2"
            :data-check="finding.check"
            data-testid="release-finding"
          >
            <span :class="finding.level === 'error' ? 'text-status-negative' : 'text-status-caution'">
              {{ $t(`release-level-${finding.level}`) }}
            </span>
            <span class="min-w-0 flex-1" translate="no">{{ finding.message }}</span>
            <Button
              v-if="releaseFix(finding).panel !== 'project'"
              size="sm"
              variant="ghost"
              :data-testid="`release-fix-${finding.check}`"
              @click="fix(releaseFix(finding).panel, group.id)"
            >
              {{ $t(releaseFix(finding).label) }}
            </Button>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
