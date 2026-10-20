<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The doctor of the studio: each check of this machine with its state, the parts that need it and its fix (a job of
 * the host or a page of the docs). It also shows the WebGPU check of this browser.
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from "lucide-vue-next";
import { webgpuWorks } from "./doctor";
import type { DoctorCheck } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const checks = computed(() => props.hub.state.checks);
const webgpu = ref<boolean | null>(null);
const fixing = ref("");
const error = ref("");

const icons = { ok: CircleCheck, warn: CircleAlert, missing: CircleX } as const;
const tones = { ok: "text-status-positive", warn: "text-status-caution", missing: "text-status-negative" } as const;

async function fix(check: DoctorCheck): Promise<void> {
  if (check.fix?.kind !== "command") return;
  fixing.value = check.id;
  try {
    const cwd = check.fix.cwd ?? props.hub.state.studio?.roots[0] ?? "";
    const job = await props.hub.api.startJob({ command: check.fix.job, cwd });
    await props.hub.finished(job.id);
    await props.hub.checkMachine();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    fixing.value = "";
  }
}

onMounted(async () => {
  if (checks.value === null) void props.hub.checkMachine();
  webgpu.value = await webgpuWorks();
});
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="doctor">
    <h2 class="text-subtitle">{{ $t("hub-doctor-title") }}</h2>
    <p v-if="checks === null" role="status" class="flex items-center gap-2 text-text-secondary">
      <LoaderCircle class="size-icon-sm animate-spin motion-reduce:animate-none" aria-hidden="true" />{{
        $t("hub-doctor-running")
      }}
    </p>
    <ul v-else class="flex flex-col divide-y divide-border-subtle rounded-card border border-border-subtle">
      <li
        v-for="check in checks ?? []"
        :key="check.id"
        :data-check="check.id"
        :data-state="check.state"
        class="flex flex-wrap items-center gap-3 p-3"
      >
        <component :is="icons[check.state]" :class="['size-icon-md shrink-0', tones[check.state]]" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="font-semibold">
            {{ $t(`hub-doctor-check-${check.id}`) }} · {{ $t(`hub-doctor-${check.state}`) }}
          </span>
          <span class="truncate text-caption text-text-secondary" translate="no">{{ check.detail }}</span>
          <span class="text-caption text-text-secondary">{{ $t("hub-doctor-needed", { what: check.needed }) }}</span>
        </div>
        <Button v-if="check.fix?.kind === 'command'" size="sm" :disabled="fixing !== ''" @click="fix(check)">
          {{ fixing === check.id ? $t("hub-doctor-running") : check.fix.label }}
        </Button>
        <a
          v-else-if="check.fix?.kind === 'docs'"
          :href="check.fix.url"
          target="_blank"
          rel="noreferrer"
          class="text-label text-text-link underline"
          >{{ check.fix.label }}</a
        >
      </li>
      <li class="flex items-center gap-3 p-3" data-check="webgpu" :data-state="webgpu ? 'ok' : 'warn'">
        <component
          :is="webgpu ? CircleCheck : CircleAlert"
          :class="['size-icon-md shrink-0', webgpu ? tones.ok : tones.warn]"
          aria-hidden="true"
        />
        <div class="flex flex-col">
          <span class="font-semibold">{{ $t("hub-doctor-webgpu") }}</span>
          <span class="text-caption text-text-secondary">
            {{
              webgpu === null ? $t("hub-doctor-running") : $t(webgpu ? "hub-doctor-webgpu-ok" : "hub-doctor-webgpu-no")
            }}
          </span>
        </div>
      </li>
    </ul>
    <p v-if="error !== ''" role="alert" class="text-status-negative">{{ $t("hub-error", { error }) }}</p>
  </section>
</template>
