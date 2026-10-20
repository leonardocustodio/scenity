<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The settings of the open checkout:
 * - the intent of its runs (the experiment log files each run under it);
 * - the Blender MCP server of the owner next to the workbench server (default off);
 * - the built lab in the visible lab frame (no HMR).
 * A new terminal and a new background run use these settings.
 */
import type { CheckoutSettings } from "@scenity/workbench-host/protocol";
import { onMounted, ref } from "vue";
import { button, cn, field } from "../layout/ui";
import type { DockHost } from "./dockHost";

defineOptions({ name: "DockCheckoutOptions" });
const props = defineProps<{ readonly dock: Pick<DockHost, "request"> }>();

const settings = ref<CheckoutSettings | null>(null);
const intent = ref("");
const error = ref<string | null>(null);

async function change(patch: { blender?: boolean; intent?: string | null; builtLab?: boolean }): Promise<void> {
  error.value = null;
  try {
    settings.value = await props.dock.request("checkout.settings", patch);
    intent.value = settings.value.intent ?? "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

onMounted(() => void change({}));
</script>

<template>
  <div class="flex flex-col gap-3 text-caption" data-testid="checkout-options">
    <form
      class="flex items-end gap-1"
      @submit.prevent="change({ intent: intent.trim() === '' ? null : intent.trim() })"
    >
      <label for="options-intent" class="flex flex-1 flex-col text-text-secondary">
        Intent of the runs (apps/editor/intents/&lt;id&gt;)
        <input
          id="options-intent"
          v-model="intent"
          :class="cn(field, 'font-mono')"
          placeholder="none"
          data-testid="options-intent"
        />
      </label>
      <button type="submit" :class="button" data-testid="options-intent-save">Save</button>
    </form>
    <label for="options-blender" class="flex items-center gap-1.5">
      <input
        id="options-blender"
        type="checkbox"
        :checked="settings?.blender === true"
        :disabled="settings === null || !settings.blenderFound"
        data-testid="options-blender"
        @change="change({ blender: ($event.target as HTMLInputElement).checked })"
      />
      Blender MCP of your user settings next to the workbench tools (new terminals and background runs)
    </label>
    <p v-if="settings !== null && !settings.blenderFound" class="text-text-secondary" data-testid="options-no-blender">
      No server named "blender" in ~/.claude.json or ~/.claude/settings.json.
    </p>
    <label for="options-built-lab" class="flex items-center gap-1.5">
      <input
        id="options-built-lab"
        type="checkbox"
        :checked="settings?.builtLab === true"
        :disabled="settings === null"
        data-testid="options-built-lab"
        @change="change({ builtLab: ($event.target as HTMLInputElement).checked })"
      />
      Built lab in the lab frame: a faster start, no HMR (for a window where you do not edit)
    </label>
    <p v-if="error !== null" class="text-status-negative" role="alert">{{ error }}</p>
  </div>
</template>
