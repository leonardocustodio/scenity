<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The `Stop` gate toggle of the Claude column. When the gate is on, the host refuses "done" while the gate check
 * fails. The gate check is the fast check of a host plugin (for example the motion checks of the take at its moments).
 * Else it is the stop gate run of the project. The line under the toggle gives the last verdict. In a browser without
 * a notification grant, a button asks for the grant (only a click can ask).
 */
import type { StopGateState } from "@scenity/workbench-host/protocol";
import { BellRing, ShieldCheck } from "lucide-vue-next";
import { computed, ref } from "vue";
import { button, cn } from "../layout/ui";

const props = defineProps<{
  readonly gate: StopGateState;
  readonly error: string | null;
  readonly disabled?: boolean;
}>();
const emit = defineEmits<{ set: [on: boolean] }>();

type Grant = "unsupported" | "default" | "granted" | "denied";
function grantNow(): Grant {
  const native = (globalThis as { Notification?: { permission: string } }).Notification;
  const inApp = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
  if (inApp || native === undefined) return "unsupported";
  return native.permission as Grant;
}
const grant = ref<Grant>(grantNow());
async function askGrant(): Promise<void> {
  const native = (globalThis as { Notification?: { requestPermission(): Promise<string> } }).Notification;
  if (native === undefined) return;
  grant.value = (await native.requestPermission()) as Grant;
}

const verdict = computed(() => {
  const last = props.gate.last;
  if (last === null) return props.gate.on ? "No check yet: the gate checks when Claude stops." : "";
  const words = last.pass ? "passes" : last.refused ? "fails: Claude goes on" : "fails";
  // The gate checks a sequence, or the whole project (`scenity check`).
  const sequence = props.gate.sequence ?? props.gate.take;
  const what = sequence === null ? "The gate" : `Sequence ${sequence}`;
  return `${what} ${words} (${new Date(last.at).toLocaleTimeString()}).`;
});
</script>

<template>
  <div class="flex shrink-0 flex-col gap-1 border-t border-border-subtle px-2 py-1.5" data-testid="stop-gate">
    <div class="flex items-center gap-2">
      <label
        for="workbench-stop-gate"
        class="mr-auto flex items-center gap-1.5 text-caption"
        :title="gate.last?.summary ?? undefined"
      >
        <input
          id="workbench-stop-gate"
          type="checkbox"
          :checked="gate.on"
          :disabled="disabled"
          data-testid="stop-gate-toggle"
          @change="emit('set', ($event.target as HTMLInputElement).checked)"
        />
        <ShieldCheck class="size-3.5 text-text-secondary" aria-hidden="true" />
        Refuse "done" while the stop gate fails
      </label>
      <button
        v-if="grant === 'default'"
        type="button"
        :class="cn(button, 'inline-flex items-center gap-1')"
        data-testid="notify-grant"
        @click="askGrant"
      >
        <BellRing class="size-3.5" aria-hidden="true" />Notify me
      </button>
    </div>
    <p v-if="verdict !== ''" class="text-caption text-text-secondary" role="status" data-testid="stop-gate-verdict">
      {{ verdict }}
    </p>
    <p v-if="error !== null" class="text-caption text-status-negative" role="alert">{{ error }}</p>
  </div>
</template>
