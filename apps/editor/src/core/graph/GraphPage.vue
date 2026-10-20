<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The metrics graph in a separate window (`?view=graph&take=<take>`): a detachable panel of the lab. When a lab page
 * is open on the same origin, the window follows its clock and its take through the clock link. Then a click seeks
 * that lab, and the lab gives the metrics. Without a lab page, a hidden lab frame measures the take (the update-only
 * sweep). Then a click moves only the cursor of this window. In a frame of the workbench (a detached window of the
 * graph), the page starts the workbench bridge. Then the link goes through the host to the lab of the main window.
 *
 * The texts are Fluent messages of `src/i18n/en-US/graph.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { select } from "../labUi";
import { takeList, takeNamed } from "../sequence";
import { openShadowLab, type ShadowLab } from "../views/shadowLab";
import { useWorkbenchBridge } from "../bridge/workbenchBridge";
import { inWorkbenchFrame } from "../bridge/workbenchLink";
import { openChannel, type ClockState } from "./clockLink";
import { GraphFollower } from "./graphFollower";
import { graphSpan, loadGraph, type GraphData } from "./graphData";
import MetricsGraph from "./MetricsGraph.vue";
import type { MetricValue } from "../../plugins";

/** The takes of the plugin. */
const PRESETS = takeList();

const { $t } = useI18n();
const params = new URLSearchParams(globalThis.location.search);
const take = ref<string | null>(params.get("take"));
const data = shallowRef<GraphData | null>(null);
const loading = ref(false);
const time = ref(Number(params.get("t")) || 0);
const linked = ref(false);
let shadow: ShadowLab | null = null;
let shownEvents = -1;
let frame = 0;

// The bridge of a frame of the workbench (the link of the host). It does nothing on a page without the workbench.
useWorkbenchBridge(shallowRef(null));
const channel = openChannel();
const follower =
  channel === null
    ? null
    : new GraphFollower(channel, {
        onClock: (state) => {
          linked.value = true;
          follow();
          if (state.take !== take.value || state.events !== shownEvents) {
            take.value = state.take;
            shownEvents = state.events;
            void load();
          }
        },
      });

function follow(): void {
  cancelAnimationFrame(frame);
  const state: ClockState | null = follower?.state ?? null;
  if (state === null) return;
  time.value = follower?.time() ?? time.value;
  frame = state.running ? requestAnimationFrame(follow) : 0;
}

/** The metrics through the hidden lab frame of this window. */
async function shadowMeasure(times: number[]): Promise<{ values: readonly MetricValue[] }[]> {
  shadow ??= openShadowLab({ query: take.value === null ? {} : { take: take.value } });
  await shadow.call("load", take.value ?? "idle");
  return shadow.call("measureAt", times);
}

async function load(): Promise<void> {
  loading.value = true;
  const start = performance.now();
  try {
    const events = takeNamed(take.value)?.events ?? [];
    const answer = linked.value ? await follower?.metrics() : null;
    if (answer?.samples) {
      const span = graphSpan(answer.take, events);
      const samples = answer.samples.filter((item) => item.at >= span[0] && item.at <= span[1]);
      const loadMs = performance.now() - start;
      data.value = { take: answer.take, samples, span, source: "link", loadMs, error: answer.error };
    } else {
      data.value = await loadGraph({ take: take.value, events, measureAt: shadowMeasure });
    }
  } finally {
    loading.value = false;
  }
}

function seek(ms: number): void {
  if (linked.value) follower?.seek(ms);
  time.value = ms;
}

function choose(value: string): void {
  take.value = value;
  const url = new URL(globalThis.location.href);
  url.searchParams.set("take", value);
  globalThis.history.replaceState(globalThis.history.state, "", url);
  void load();
}

onMounted(async () => {
  // A lab page of this origin answers the hello immediately. Else, the hidden frame measures.
  // Through the host, the answer takes more time, because the main window can still load its lab.
  await follower?.waitMain(inWorkbenchFrame() ? 3_000 : 400);
  if (!linked.value) await load();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  follower?.close();
  shadow?.dispose();
});
</script>

<template>
  <main class="flex min-h-dvh flex-col gap-3 bg-surface-base p-4 text-text-primary" data-testid="graph-page">
    <header class="flex flex-wrap items-center gap-3">
      <h1 class="text-subtitle">
        {{ take === null ? $t("graph-metrics-no-take") : $t("graph-metrics-of", { take }) }}
      </h1>
      <span class="text-caption text-text-secondary" data-testid="graph-page-link">
        {{ linked ? $t("graph-page-linked") : $t("graph-page-alone") }}
      </span>
      <label v-if="!linked" for="graph-page-take" class="ml-auto flex items-center gap-1.5 text-caption">
        <span>{{ $t("graph-page-take") }}</span>
        <select
          id="graph-page-take"
          :class="select"
          :value="take ?? 'idle'"
          data-testid="graph-page-take"
          @change="choose(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="item in PRESETS" :key="item.name" :value="item.name" translate="no">
            {{ item.label }} ({{ item.name }})
          </option>
        </select>
      </label>
    </header>
    <MetricsGraph :data="data" :time="time" :loading="loading" @seek="seek" />
  </main>
</template>
