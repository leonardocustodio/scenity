<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Performance panel: the frame statistics of the core (each value of `stats()`, read each second while the panel
 * shows), the cost of each entity (the inspect report; a click selects it), and the
 * switches of the tier, the backend and the render worker (the render settings; a reload uses them).
 */
import { useI18n } from "@scenity/i18n";
import type { SceneStats } from "@scenity/runtime/protocol";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { RENDER_BACKENDS, RENDER_TIERS } from "@scenity/scene/schema/editor";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePanelVisible } from "../../studio/shell/panelState";
import { pageSettings } from "../settings/pageSettings";
import { entityCosts, statRows } from "./perfStats";

const props = defineProps<{
  readStats: () => Promise<SceneStats | null>;
  inspect: () => Promise<SceneInspectReport | null>;
  select: (id: string) => void;
}>();
const { $t } = useI18n();
const visible = usePanelVisible();
const stats = shallowRef<SceneStats | null>(null);
const report = shallowRef<SceneInspectReport | null>(null);
const changed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function read(): Promise<void> {
  clearTimeout(timer);
  [stats.value, report.value] = await Promise.all([
    props.readStats().catch(() => null),
    props.inspect().catch(() => null),
  ]);
  if (visible.value) timer = setTimeout(() => void read(), 1000);
}
watch(visible, (shown) => (shown ? void read() : clearTimeout(timer)), { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));

const rows = computed(() => (stats.value === null ? [] : statRows(stats.value)));
const costs = computed(() => (report.value === null ? [] : entityCosts(report.value)));
const render = computed(() => pageSettings().value.render);

async function setRender(key: "tier" | "backend" | "worker", value: string | boolean): Promise<void> {
  const failed = await pageSettings().set(`render.${key}`, value);
  changed.value = failed === null;
}
/** A new tier, backend or worker takes a new core: the page loads again. */
function reload(): void {
  location.reload();
}
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-3 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-performance')"
    data-testid="performance-panel"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h3 class="font-medium">{{ $t("perf-frame") }}</h3>
      <p v-if="stats === null" class="text-text-secondary">{{ $t("perf-no-stats") }}</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3" data-testid="perf-stats">
        <template v-for="row in rows" :key="row.key">
          <dt class="text-text-secondary">{{ $t(row.label, { key: row.key }) }}</dt>
          <dd class="truncate font-mono" translate="no" :title="row.text" :data-key="row.key" data-testid="perf-stat">
            {{ row.text }}
          </dd>
        </template>
      </dl>
      <h3 class="mt-1 font-medium">{{ $t("perf-switches") }}</h3>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1" for="perf-tier">
          {{ $t("perf-tier") }}
          <select
            id="perf-tier"
            :value="render.tier"
            :class="input"
            data-testid="perf-tier"
            @change="setRender('tier', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="tier in RENDER_TIERS" :key="tier" :value="tier" translate="no">{{ tier }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1" for="perf-backend">
          {{ $t("perf-backend") }}
          <select
            id="perf-backend"
            :value="render.backend"
            :class="input"
            data-testid="perf-backend"
            @change="setRender('backend', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="backend in RENDER_BACKENDS" :key="backend" :value="backend" translate="no">
              {{ backend }}
            </option>
          </select>
        </label>
        <label class="flex items-center gap-1" for="perf-worker">
          <input
            id="perf-worker"
            type="checkbox"
            :checked="render.worker"
            data-testid="perf-worker"
            @change="setRender('worker', ($event.target as HTMLInputElement).checked)"
          />
          {{ $t("perf-worker") }}
        </label>
        <Button v-if="changed" size="sm" data-testid="perf-reload" @click="reload">
          {{ $t("perf-reload") }}
        </Button>
      </div>
    </div>
    <div class="flex w-[45%] shrink-0 flex-col gap-1">
      <h3 class="font-medium">{{ $t("perf-costs") }}</h3>
      <table class="w-full" data-testid="perf-costs">
        <thead>
          <tr class="text-left text-text-secondary">
            <th class="font-normal">{{ $t("perf-cost-entity") }}</th>
            <th class="text-right font-normal">{{ $t("perf-cost-triangles") }}</th>
            <th class="text-right font-normal">{{ $t("perf-cost-draws") }}</th>
            <th class="text-right font-normal">{{ $t("perf-cost-meshes") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cost in costs" :key="cost.id" :data-entity="cost.id" data-testid="perf-cost">
            <td>
              <button type="button" class="text-text-link hover:underline" translate="no" @click="select(cost.id)">
                {{ cost.name }}
              </button>
            </td>
            <td class="text-right font-mono">{{ cost.triangles.toLocaleString("en-US") }}</td>
            <td class="text-right font-mono">{{ cost.instanced ? "inst." : cost.drawCalls }}</td>
            <td class="text-right font-mono">{{ cost.meshes }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
