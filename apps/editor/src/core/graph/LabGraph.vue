<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The metrics graph on the scene of the lab page. A button opens a card with the graph of the take (MetricsGraph.vue)
 * above the scene. A click on the graph seeks the clock, and the cursor follows the clock. "Open in a window" opens
 * the graph (`?view=graph`) in a separate browser window that follows this clock through the clock link
 * (publishClock.ts). The link runs while the page is open, also when the card is closed. In a frame of the workbench,
 * the link goes through the host, and "Open in a window" asks the workbench page for the window. A follower window (a
 * detached pane, the separate content browser) moves this clock with `drive`. `graph=1` in the URL opens the card at
 * the start.
 *
 * The texts are Fluent messages of `src/i18n/en-US/graph.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { ChartLine, ExternalLink, RefreshCw, X } from "lucide-vue-next";
import { onBeforeUnmount, ref, watch } from "vue";
import { useLab } from "../labContext";
import { button } from "../labUi";
import MetricsGraph from "./MetricsGraph.vue";
import { applyClockState } from "../follow/applyClock";
import { inWorkbench } from "../follow/detach";
import { publishClock } from "./publishClock";
import { useLabGraphData } from "./useLabGraphData";

const props = withDefaults(defineProps<{ readonly beside?: boolean }>(), { beside: false });
const { $t } = useI18n();
const { take, clock, renderer, trackName, browser } = useLab();
const open = ref(new URLSearchParams(globalThis.location.search).get("graph") === "1");
const graph = useLabGraphData({
  clock,
  base: () => take.base.value,
  events: () => take.events.value,
  // The key of the frames of the page. The index has the metrics of each frame.
  keyState: () =>
    trackName !== null
      ? null
      : {
          take: take.base.value,
          track: null,
          events: take.events.value,
          tunes: renderer.tunes.value,
          debug: renderer.debug.value,
          assets: renderer.useAssets.value,
          reduced: renderer.reduced.value,
          tier: renderer.tier.value,
        },
});
const item = (): string | null => browser?.item.value?.key ?? null;
publishClock({
  clock,
  take,
  metrics: () => graph.load(),
  item,
  drive: (state) => {
    applyClockState(
      { clock, take, item, ...(browser ? { open: (key: string) => void browser.open(key) } : {}) },
      state,
    );
  },
});

/** The cursor time: the clock at each paint while it runs, else its display time. */
const time = ref(clock.simNow());
let frame = 0;
function follow(): void {
  time.value = clock.simNow();
  frame = clock.running.value && open.value ? requestAnimationFrame(follow) : 0;
}
watch(
  () => [open.value, clock.running.value, clock.displayMs.value, clock.epoch.value] as const,
  () => {
    if (frame === 0) follow();
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));

watch(
  () => [open.value, take.base.value, take.events.value] as const,
  ([shown]) => {
    if (shown) void graph.load();
  },
  { immediate: true },
);

function seek(ms: number): void {
  clock.seek(ms);
  time.value = ms;
}

function detach(): void {
  if (inWorkbench()) {
    const query: Record<string, string> = take.base.value === null ? {} : { take: take.base.value };
    globalThis.__workbench?.emit({ event: "detach", panel: "graph", query });
    return;
  }
  const url = new URL(globalThis.location.href);
  const query = new URLSearchParams({ view: "graph" });
  if (take.base.value !== null) query.set("take", take.base.value);
  url.search = query.toString();
  url.hash = "";
  globalThis.open(url.toString(), "scenity-lab-graph", "popup,width=960,height=760");
}
</script>

<template>
  <div
    :class="
      cn(
        'pointer-events-none absolute top-3 z-10 flex w-[min(46rem,calc(100%-1.5rem))] flex-col items-end gap-2 *:pointer-events-auto',
        props.beside ? 'right-14 pointer-coarse:right-16' : 'right-3',
      )
    "
  >
    <button
      v-if="!open"
      data-scene-control
      type="button"
      :class="cn(button, 'inline-flex items-center gap-1.5 shadow-overlay pointer-coarse:min-h-11')"
      :title="$t('graph-open-title')"
      data-testid="lab-graph-open"
      @click="open = true"
    >
      <ChartLine class="size-4" aria-hidden="true" /> {{ $t("graph-open") }}
    </button>
    <section
      v-else
      class="flex max-h-[min(36rem,calc(100dvh-8rem))] w-full flex-col gap-2 overflow-y-auto rounded-card bg-surface-overlay/95 p-3 shadow-overlay"
      :aria-label="$t('graph-card')"
      data-scene-control
      data-testid="lab-graph"
    >
      <header class="flex items-center gap-1.5">
        <h2 class="mr-auto text-label">
          {{
            take.base.value === null ? $t("graph-metrics-no-take") : $t("graph-metrics-of", { take: take.base.value })
          }}
        </h2>
        <button
          type="button"
          :class="cn(button, 'inline-flex size-8 items-center justify-center p-0')"
          :title="$t('graph-measure-again')"
          :aria-label="$t('graph-measure-again')"
          @click="graph.load(true)"
        >
          <RefreshCw class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="cn(button, 'inline-flex size-8 items-center justify-center p-0')"
          :title="$t('graph-detach')"
          :aria-label="$t('graph-detach')"
          data-testid="lab-graph-detach"
          @click="detach"
        >
          <ExternalLink class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="cn(button, 'inline-flex size-8 items-center justify-center p-0')"
          :title="$t('graph-close')"
          :aria-label="$t('graph-close')"
          @click="open = false"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </header>
      <MetricsGraph :data="graph.data.value" :time="time" :loading="graph.loading.value" @seek="seek" />
    </section>
  </div>
</template>
