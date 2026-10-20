<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The asset flow in the Runs tab. `labs asset <id> --dry` prints the steps. The real `labs asset <id>` (import,
 * export, build, budgets and the turntable sheet) runs only after a confirmation. The sheet shows with the images of
 * the run.
 */
import { ref } from "vue";
import { button, field } from "../layout/ui";
import type { RunsApi } from "./useRuns";

defineOptions({ name: "DockAssetRun" });
const props = defineProps<{ readonly runs: Pick<RunsApi, "start"> }>();

const id = ref("");
const confirming = ref(false);

async function real(): Promise<void> {
  confirming.value = false;
  await props.runs.start("asset", [id.value.trim()], true);
}
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="asset-run">
    <form class="flex gap-1" @submit.prevent="runs.start('asset', [id.trim(), '--dry'])">
      <input v-model="id" :class="field" aria-label="Asset ID" placeholder="asset ID" data-testid="asset-id" />
      <button type="submit" :class="button" :disabled="id.trim() === ''" data-testid="asset-dry">Asset (dry)</button>
      <button
        type="button"
        :class="button"
        :disabled="id.trim() === ''"
        data-testid="asset-real"
        @click="confirming = true"
      >
        Asset…
      </button>
    </form>
    <div
      v-if="confirming"
      role="alertdialog"
      aria-labelledby="asset-title"
      class="flex flex-col gap-1 rounded-control border border-status-caution bg-surface-sunken p-2"
      data-testid="asset-confirm"
    >
      <p id="asset-title" class="text-caption">
        Run <code class="font-mono">labs asset {{ id.trim() }}</code
        >: Blender import and export, the build into the runtime assets, the budgets and the turntable sheet. It writes
        files of the checkout.
      </p>
      <div class="flex gap-1">
        <button type="button" :class="button" data-testid="asset-confirm-run" @click="real">Run</button>
        <button type="button" :class="button" @click="confirming = false">Back</button>
      </div>
    </div>
  </div>
</template>
