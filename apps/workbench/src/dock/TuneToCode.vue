<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Tune to code: the tune values of the lab go to `labs tune-apply`. The dry run comes first and shows the lines that
 * will change. Then the owner applies them to the runtime source.
 */
import { computed, ref } from "vue";
import type { HostRequest } from "../host/useHost";
import { button } from "../layout/ui";
import type { RunsApi } from "./useRuns";

const props = defineProps<{
  readonly request: HostRequest;
  readonly runs: RunsApi;
}>();

const run = ref<string | null>(null);
const dry = ref(true);
const values = ref("");
const error = ref<string | null>(null);

const info = computed(() => props.runs.runs.value.find((item) => item.run === run.value) ?? null);
const output = computed(() => (run.value === null ? "" : (props.runs.output.value[run.value] ?? "")));
const dryPassed = computed(() => dry.value && info.value?.status === "passed");

async function apply(asDry: boolean): Promise<void> {
  error.value = null;
  try {
    const result = await props.request("tunes.apply", { dry: asDry });
    run.value = result.run;
    values.value = result.values;
    dry.value = asDry;
    props.runs.follow(result.run);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}
</script>

<template>
  <section class="flex flex-col gap-1" aria-label="Tune to code" data-testid="tune-to-code">
    <div class="flex flex-wrap items-center gap-1">
      <button type="button" :class="button" data-testid="tune-dry" @click="apply(true)">Tune to code (dry run)</button>
      <button v-if="dryPassed" type="button" :class="button" data-testid="tune-apply" @click="apply(false)">
        Apply to the runtime source
      </button>
      <code v-if="values !== ''" class="truncate font-mono text-caption text-text-secondary">{{ values }}</code>
    </div>
    <p v-if="error !== null" class="text-caption text-status-negative" role="alert">{{ error }}</p>
    <pre
      v-if="run !== null"
      class="max-h-32 overflow-auto rounded-control bg-surface-sunken p-2 font-mono text-caption whitespace-pre-wrap"
      data-testid="tune-output"
      >{{ info?.status ?? "running" }}{{ dry ? " (dry run)" : "" }}
{{ output }}</pre>
  </section>
</template>
