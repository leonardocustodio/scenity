<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The frame rate of the renderer on the scene of the 3D room lab. It does not show in a fixed frame of the visual
 * tests. A press on it opens the card of the frame statistics under it, with the GPU of the probe and every asset
 * failure of the scene. The pill shows the count of the failures, thus they do not stay hidden in a closed card.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The GPU name and each asset failure are data
 * values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { ChevronDown } from "lucide-vue-next";
import { computed } from "vue";
import { useLab } from "./labContext";

/** The card is open. When it is open, the page runs the GPU timer. */
const open = defineModel<boolean>("open", { required: true });
const { $t } = useI18n();
const { stats, renderer } = useLab();
const { shownFps, frameRows } = stats;
const probe = renderer.probe;
/** Every asset failure of the scene, not only the first one of the console. */
const failures = computed(() => stats.stats.value?.failures ?? []);
</script>

<template>
  <div v-if="shownFps !== null" class="flex flex-col items-start gap-1.5" data-scene-control>
    <button
      type="button"
      :class="
        cn(
          'inline-flex items-center gap-1 rounded-pill bg-surface-overlay/85 px-2.5 py-1 font-mono text-caption tabular-nums shadow-overlay hover:bg-surface-overlay pointer-coarse:min-h-11',
          shownFps < 30 ? 'text-status-caution' : 'text-text-primary',
        )
      "
      :title="$t('lab-frame-stats')"
      aria-controls="lab-frame-stats"
      :aria-expanded="open"
      data-testid="lab-fps"
      @click="open = !open"
    >
      {{ $t("lab-fps", { fps: String(shownFps) }) }}
      <span
        v-if="failures.length > 0"
        class="rounded-pill bg-status-caution px-1.5 text-text-on-accent"
        :title="$t('lab-fps-failures', { count: String(failures.length) })"
        data-testid="lab-fps-failures"
        >{{ failures.length }} !</span
      >
      <ChevronDown
        :class="cn('size-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-180')"
        aria-hidden="true"
      />
    </button>
    <dl
      v-show="open"
      id="lab-frame-stats"
      class="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 rounded-card bg-surface-overlay/85 px-3 py-2 font-mono text-caption tabular-nums shadow-overlay"
      :aria-label="$t('lab-frame-stats')"
      data-testid="lab-frame-stats"
    >
      <template v-for="[label, value, hint] in frameRows" :key="label">
        <dt class="text-text-secondary" :title="hint">{{ label }}</dt>
        <dd class="m-0 text-right text-text-primary">{{ value }}</dd>
      </template>
      <dt class="text-text-secondary" :title="$t('lab-probe-hint')">{{ $t("lab-probe") }}</dt>
      <dd class="m-0 max-w-64 truncate text-right text-text-primary" :title="probe.renderer ?? undefined">
        {{
          probe.ok
            ? $t("lab-probe-ok", { gpu: probe.renderer ?? $t("lab-probe-unknown"), tier: probe.tier })
            : $t("lab-probe-failed", { gpu: probe.renderer ?? $t("lab-probe-unknown"), reason: probe.reason ?? "" })
        }}
      </dd>
      <template v-if="failures.length > 0">
        <dt class="col-span-2 mt-1 text-status-caution">{{ $t("lab-asset-failures") }}</dt>
        <dd class="col-span-2 m-0 font-sans text-status-caution" data-testid="lab-failures">
          <ul class="m-0 flex max-w-96 list-disc flex-col gap-0.5 pl-4">
            <li v-for="item in failures" :key="item" translate="no">{{ item }}</li>
          </ul>
        </dd>
      </template>
    </dl>
  </div>
</template>
