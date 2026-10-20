<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The scene pool in Preferences → Advanced. It shows the state of the pool of the machine (its pages, the warm pages,
 * the leases), Start with a count of pages, Stop and Refresh. The dev server runs the pool (scripts/poolApi.ts).
 * `scenity shot`, `sheet` and `clip` use the pool while it runs.
 */
import { useI18n } from "@scenity/i18n";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";

interface PoolState {
  readonly running: boolean;
  readonly starting: boolean;
  readonly origin?: string;
  readonly pages?: readonly { readonly busy: boolean; readonly warm: boolean }[];
  readonly leases?: number;
  readonly waiting?: number;
}

const { $t } = useI18n();
const state = shallowRef<PoolState | null>(null);
const pages = ref("2");
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

async function read(): Promise<void> {
  clearTimeout(timer);
  const response = await fetch("/pool.json", { cache: "no-store" }).catch(() => null);
  state.value =
    response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")
      ? ((await response.json()) as PoolState)
      : null;
  if (state.value?.starting === true) timer = setTimeout(() => void read(), 1000);
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function act(action: "start" | "stop"): Promise<void> {
  const response = await fetch("/pool.run", {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({ action, pages: Number(pages.value) }),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) note.value = response.message;
  else {
    const answer = (await response.json()) as { ok: boolean; reason?: string };
    note.value = answer.ok ? null : (answer.reason ?? null);
  }
  await read();
}
const button = "rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised disabled:opacity-50";
</script>

<template>
  <section class="flex flex-col gap-1" :aria-label="$t('settings-advanced')" data-testid="settings-pool">
    <h3 class="font-semibold">{{ $t("settings-advanced") }}</h3>
    <h4 class="font-medium">{{ $t("pool") }}</h4>
    <p class="text-text-secondary">{{ $t("pool-hint") }}</p>
    <p v-if="state === null" class="text-text-secondary">{{ $t("pool-no-server") }}</p>
    <p
      v-else
      :class="state.running ? 'text-status-positive' : 'text-text-secondary'"
      :data-running="state.running ? '1' : '0'"
      data-testid="pool-state"
    >
      {{
        state.running
          ? $t("pool-running", {
              pages: state.pages?.length ?? 0,
              warm: state.pages?.filter((page) => page.warm).length ?? 0,
              leases: state.leases ?? 0,
            })
          : state.starting
            ? $t("pool-starting")
            : $t("pool-stopped")
      }}
    </p>
    <div class="flex flex-wrap items-center gap-1">
      <label class="flex items-center gap-1" for="pool-pages">
        {{ $t("pool-pages") }}
        <input
          id="pool-pages"
          v-model="pages"
          class="h-7 w-12 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-text-primary"
          data-testid="pool-pages"
        />
      </label>
      <button
        type="button"
        :class="button"
        :disabled="state?.running === true"
        data-testid="pool-start"
        @click="act('start')"
      >
        {{ $t("pool-start") }}
      </button>
      <button
        type="button"
        :class="button"
        :disabled="state?.running !== true"
        data-testid="pool-stop"
        @click="act('stop')"
      >
        {{ $t("pool-stop") }}
      </button>
      <button type="button" :class="button" data-testid="pool-refresh" @click="read">{{ $t("pool-refresh") }}</button>
    </div>
    <p v-if="note !== null" class="text-status-negative" role="alert">{{ note }}</p>
  </section>
</template>
