<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The compare view of the lab (`?view=compare&a=take:first&b=take:second&t=14136&camera=front`). It shows two takes,
 * or a take of the current code and the same take of an older content hash. The two sides are side by side or in a
 * wipe, on one linked clock. The frames come from the frame index of the lab page. Else a hidden lab frame draws them,
 * and the index keeps them. Space plays and pauses. Comma and period step 100 ms (with Shift: 1 s). W toggles the wipe.
 * The URL keeps the state, so a reload or a link shows the same frames.
 *
 * The texts are Fluent messages of `src/i18n/en-US/compare.ftl`. The take and camera names are data values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { Columns2, Pause, Play, SplitSquareHorizontal } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { cameraNames } from "../cameras";
import { graphSpan } from "../graph/graphData";
import { openBrowserIndex } from "../index/browserIndex";
import { contentHash } from "../index/contentHash";
import { button, clockText, select, typingInto } from "../labUi";
import { compareTakeName, defaultTakeName, takeList, takeNamed } from "../sequence";
import { openShadowLab, type ShadowLab } from "../views/shadowLab";
import { CompareFrames } from "./compareFrames";
import { COMPARE_TIER } from "./frameInput";
import CompareStage from "./CompareStage.vue";
import { shadowRenderer } from "./shadowRender";
import { compareParams, compareQuery, sideLabel, type CompareMode, type CompareSide, type StageSide } from "./sources";
import { COMPARE_STEP_MS, useCompare } from "./useCompare";

/** The takes of the plugin. */
const PRESETS = takeList();

/** The takes of the two sides when the URL has no take: the defaults of the plugin. */
const TAKE_A = defaultTakeName() ?? "";
const TAKE_B = compareTakeName(TAKE_A) ?? TAKE_A;

/** The named cameras of the plugin. */
const CAMERA_NAMES = cameraNames();

const { $t } = useI18n();
const start = compareParams(globalThis.location.search);
const mode = ref<CompareMode>(start.mode);
const split = ref(start.split);
const index = openBrowserIndex().catch(() => null);
const hashes = ref<string[]>([]);
let shadow: ShadowLab | null = null;
let draw: ReturnType<typeof shadowRenderer> | null = null;

const frames = new CompareFrames({
  store: async () => (await index)?.store ?? null,
  contentHash: () => contentHash.value,
  render: (take, timeMs, camera) => {
    // Use the tier of the plain take input (frameInput.ts), so the drawn frame agrees with its key.
    shadow ??= openShadowLab({ query: { take, camera, tier: COMPARE_TIER } });
    draw ??= shadowRenderer(shadow);
    return draw(take, timeMs, camera);
  },
});

const compare = useCompare({
  frame: (side, timeMs, camera) => frames.frame(side, timeMs, camera),
  a: start.a ?? { kind: "take", take: TAKE_A },
  b: start.b ?? { kind: "take", take: TAKE_B },
  timeMs: start.timeMs,
  camera: start.camera,
  end: (a, b) =>
    Math.max(...[a, b].map((side) => graphSpan(side?.take ?? null, takeNamed(side?.take ?? null)?.events ?? [])[1])),
});

function stageSide(side: CompareSide | null, which: "a" | "b"): StageSide {
  const shot = compare.shots.value[which];
  return { label: sideLabel(side), url: shot?.url ?? null, note: shot?.note ?? null, simMs: shot?.simMs ?? null };
}
const sideA = computed(() => stageSide(compare.a.value, "a"));
const sideB = computed(() => stageSide(compare.b.value, "b"));
/** The views of the stage: the value, the message ID of the title and the icon. */
const MODES = [
  { value: "side", title: "compare-mode-side", icon: Columns2 },
  { value: "wipe", title: "compare-mode-wipe", icon: SplitSquareHorizontal },
] as const;
const status = computed(() => {
  const { a, b } = compare.shots.value;
  return $t("compare-status", {
    aFrom: a?.from ?? "empty",
    aMs: a?.ms.toFixed(0) ?? "",
    bFrom: b?.from ?? "empty",
    bMs: b?.ms.toFixed(0) ?? "",
  });
});

/** The code select of a side: "now" (the current code) or an older content hash of the index. */
function codeOf(side: CompareSide | null): string {
  return side?.kind === "hash" ? side.contentHash : "now";
}
function setTake(which: "a" | "b", take: string): void {
  const old = which === "a" ? compare.a.value : compare.b.value;
  const code = codeOf(old);
  void compare.setSide(which, code === "now" ? { kind: "take", take } : { kind: "hash", take, contentHash: code });
}
function setCode(which: "a" | "b", code: string): void {
  const take = (which === "a" ? compare.a.value : compare.b.value)?.take ?? TAKE_A;
  void compare.setSide(which, code === "now" ? { kind: "take", take } : { kind: "hash", take, contentHash: code });
}

watch(
  () =>
    [compare.a.value, compare.b.value, compare.timeMs.value, compare.camera.value, mode.value, split.value] as const,
  ([a, b, timeMs, camera]) => {
    const url = new URL(globalThis.location.href);
    url.search = compareQuery({ a, b, timeMs, camera, mode: mode.value, split: split.value });
    globalThis.history.replaceState(globalThis.history.state, "", url);
  },
);

function onKey(event: KeyboardEvent): void {
  if (typingInto(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  const step = event.shiftKey ? 1000 : COMPARE_STEP_MS;
  if (event.key === " ") {
    event.preventDefault();
    if (compare.playing.value) compare.pause();
    else compare.play();
  } else if (event.key === "," || event.key === "<") void compare.step(-step);
  else if (event.key === "." || event.key === ">") void compare.step(step);
  else if (event.key === "w" || event.key === "W") mode.value = mode.value === "wipe" ? "side" : "wipe";
}

onMounted(async () => {
  globalThis.addEventListener("keydown", onKey);
  void compare.seek(compare.timeMs.value);
  const store = (await index)?.store;
  const uses = (await store?.contents()) ?? [];
  hashes.value = uses.map((use) => use.contentHash).filter((hash) => hash !== contentHash.value);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener("keydown", onKey);
  compare.pause();
  frames.clear();
  shadow?.dispose();
});
</script>

<template>
  <main
    class="flex min-h-dvh flex-col gap-3 bg-surface-base p-4 text-text-primary"
    data-testid="compare-page"
    :data-shown="compare.shown.value ?? undefined"
    :data-pair-ms="compare.pairMs.value === null ? undefined : compare.pairMs.value.toFixed(0)"
  >
    <header class="flex flex-wrap items-end gap-3 text-caption">
      <h1 class="mr-2 text-subtitle">{{ $t("compare-title") }}</h1>
      <fieldset v-for="which in ['a', 'b'] as const" :key="which" class="flex items-end gap-1.5">
        <legend class="sr-only">{{ $t("compare-side", { side: which.toUpperCase() }) }}</legend>
        <label :for="`compare-take-${which}`" class="flex flex-col gap-0.5">
          <span class="font-mono">{{ which.toUpperCase() }}</span>
          <select
            :id="`compare-take-${which}`"
            :class="select"
            :value="(which === 'a' ? compare.a.value : compare.b.value)?.take"
            :data-testid="`compare-take-${which}`"
            @change="setTake(which, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in PRESETS" :key="item.name" :value="item.name" translate="no">
              {{ item.name }}
            </option>
          </select>
        </label>
        <label :for="`compare-code-${which}`" class="flex flex-col gap-0.5">
          <span class="text-text-secondary">{{ $t("compare-code") }}</span>
          <select
            :id="`compare-code-${which}`"
            :class="select"
            :value="codeOf(which === 'a' ? compare.a.value : compare.b.value)"
            :data-testid="`compare-code-${which}`"
            @change="setCode(which, ($event.target as HTMLSelectElement).value)"
          >
            <option value="now">{{ $t("compare-code-now") }}</option>
            <option v-for="hash in hashes" :key="hash" :value="hash">
              {{ $t("compare-code-hash", { hash: hash.slice(0, 12) }) }}
            </option>
          </select>
        </label>
      </fieldset>
      <label for="compare-camera" class="flex flex-col gap-0.5">
        <span class="text-text-secondary">{{ $t("compare-camera") }}</span>
        <select
          id="compare-camera"
          :class="select"
          :value="compare.camera.value"
          data-testid="compare-camera"
          @change="compare.setCamera(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="name in CAMERA_NAMES" :key="name" :value="name" translate="no">{{ name }}</option>
        </select>
      </label>
      <div class="ml-auto flex gap-0.5" role="tablist" :aria-label="$t('compare-view')">
        <button
          v-for="item in MODES"
          :key="item.value"
          type="button"
          role="tab"
          :aria-selected="mode === item.value"
          :class="
            cn(
              button,
              'inline-flex size-9 items-center justify-center p-0',
              mode === item.value && 'border-accent-brand',
            )
          "
          :title="$t(item.title)"
          :data-testid="`compare-mode-${item.value}`"
          @click="mode = item.value"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
    <CompareStage v-model:split="split" :a="sideA" :b="sideB" :mode="mode" />
    <div class="flex items-center gap-2 text-caption" data-testid="compare-clock">
      <button
        type="button"
        :class="cn(button, 'inline-flex size-9 items-center justify-center p-0')"
        :aria-label="compare.playing.value ? $t('compare-pause') : $t('compare-play')"
        :title="compare.playing.value ? $t('compare-pause-title') : $t('compare-play-title')"
        data-testid="compare-play"
        @click="compare.playing.value ? compare.pause() : compare.play()"
      >
        <component :is="compare.playing.value ? Pause : Play" class="size-4" aria-hidden="true" />
      </button>
      <input
        type="range"
        min="0"
        :max="compare.end()"
        :step="COMPARE_STEP_MS"
        :value="compare.timeMs.value"
        class="flex-1"
        :aria-label="$t('compare-time')"
        data-testid="compare-time"
        @input="compare.seek(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="w-24 text-right font-mono" data-testid="compare-time-text">
        {{ clockText(compare.timeMs.value) }}.{{ String(Math.floor((compare.timeMs.value % 1000) / 100)) }}
      </span>
    </div>
    <p class="font-mono text-caption text-text-secondary" role="status" data-testid="compare-status">
      {{ compare.busy.value ? $t("compare-drawing") : status }}
    </p>
  </main>
</template>
