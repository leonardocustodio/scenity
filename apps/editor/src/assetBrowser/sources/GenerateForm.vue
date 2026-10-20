<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The generated asset form: a generator, a kind, a text, then "Get the cost". The cost of the run shows first.
 * Generate runs only after it, for the same text and kind. The result imports with the rights
 * record of kind "generated" of the generator.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { computed, ref, watch } from "vue";
import type { AssetSource } from "../assetClient";
import type { AssetImportResult, GenerateEstimateResult, GeneratorInfo, SourceKindName } from "../assetTypes";

const props = defineProps<{ source: AssetSource; generators: readonly GeneratorInfo[] }>();
const emit = defineEmits<{ imported: [result: Extract<AssetImportResult, { ok: true }>] }>();
const { $t } = useI18n();
const generator = ref(props.generators[0]?.id ?? "");
const kind = ref<SourceKindName>("model");
const prompt = ref("");
const estimate = ref<GenerateEstimateResult | null>(null);
const busy = ref(false);
const reason = ref<string | null>(null);

const options = computed(() => props.generators.map((each) => ({ value: each.id, label: each.name })));
const kinds = computed(() => props.generators.find((each) => each.id === generator.value)?.kinds ?? []);
// A new text, kind or generator needs a new cost before a run.
watch([generator, kind, prompt], () => (estimate.value = null));

async function cost(): Promise<void> {
  if (props.source.estimateGenerate === undefined) return;
  busy.value = true;
  estimate.value = await props.source.estimateGenerate({
    generator: generator.value,
    prompt: prompt.value,
    kind: kind.value,
  });
  busy.value = false;
  reason.value = estimate.value.ok ? null : estimate.value.reason;
}

async function run(): Promise<void> {
  if (props.source.generate === undefined || estimate.value?.ok !== true) return;
  busy.value = true;
  const result = await props.source.generate({ generator: generator.value, prompt: prompt.value, kind: kind.value });
  busy.value = false;
  if (result.ok) emit("imported", result);
  else reason.value = result.reason;
}
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="generate-form">
    <div class="flex flex-wrap items-center gap-1">
      <Select
        v-model="generator"
        :options="options"
        class="w-40"
        :aria-label="$t('generate-generator')"
        data-testid="generate-generator"
      />
      <label class="flex items-center gap-1" for="generate-kind">
        {{ $t("generate-kind") }}
        <select id="generate-kind" v-model="kind" :class="input" data-testid="generate-kind">
          <option v-for="each in kinds" :key="each" :value="each">{{ $t(`sources-kind-${each}`) }}</option>
        </select>
      </label>
    </div>
    <label class="flex flex-col gap-0.5" for="generate-prompt">
      {{ $t("generate-prompt") }}
      <textarea
        id="generate-prompt"
        v-model="prompt"
        rows="2"
        class="rounded-control border border-border-subtle bg-surface-sunken p-1.5 text-text-primary"
        data-testid="generate-prompt"
      />
    </label>
    <div class="flex flex-wrap items-center gap-1">
      <Button size="sm" :disabled="busy || prompt.trim() === ''" data-testid="generate-estimate" @click="cost">
        {{ $t("generate-estimate") }}
      </Button>
      <span v-if="estimate?.ok === true" data-testid="generate-cost" :data-cost="estimate.cost">
        {{ $t("generate-cost", { cost: estimate.cost, unit: estimate.unit, seconds: estimate.seconds }) }}
      </span>
      <Button
        size="sm"
        variant="primary"
        :disabled="busy || estimate?.ok !== true"
        data-testid="generate-run"
        @click="run"
      >
        {{ busy ? $t("generate-running") : $t("generate-run") }}
      </Button>
    </div>
    <p class="text-text-secondary">{{ $t("generate-rights-note") }}</p>
    <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
  </div>
</template>
