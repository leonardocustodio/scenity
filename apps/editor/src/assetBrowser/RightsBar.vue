<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rights bar of the asset browser: the count of the picked assets, a rights record of the
 * project, and Assign, which gives the record to each picked asset.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { computed, ref, watch } from "vue";
import type { RightsSummary } from "./assetTypes";

const props = defineProps<{ count: number; records: readonly RightsSummary[] }>();
const emit = defineEmits<{ assign: [rights: string]; clear: [] }>();
const { $t } = useI18n();
const options = computed(() =>
  props.records.map((record) => ({ value: record.path, label: `${record.name} · ${record.spdx ?? record.licence}` })),
);
const rights = ref(props.records[0]?.path ?? "");
watch(
  () => props.records,
  (records) => {
    if (!records.some((record) => record.path === rights.value)) rights.value = records[0]?.path ?? "";
  },
);
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1 border-b border-border-subtle bg-surface-overlay px-1.5 py-1 text-caption"
    role="group"
    :aria-label="$t('assets-rights-bar')"
    data-testid="asset-rights-bar"
  >
    <span>{{ $t("assets-picked", { count }) }}</span>
    <Select
      v-if="options.length > 0"
      v-model="rights"
      :options="options"
      class="w-64"
      :aria-label="$t('assets-rights-record')"
      data-testid="asset-rights-record"
    />
    <Button
      size="sm"
      variant="primary"
      :disabled="rights === ''"
      data-testid="asset-rights-assign"
      @click="emit('assign', rights)"
    >
      {{ $t("assets-rights-assign") }}
    </Button>
    <Button size="sm" variant="ghost" data-testid="asset-rights-clear" @click="emit('clear')">
      {{ $t("assets-picked-clear") }}
    </Button>
  </div>
</template>
