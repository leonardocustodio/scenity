<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Frame index panel: the frames of the project by sequence, camera and time (a row for
 * each camera, a column for each time; the moments of a sequence have a mark). A frame whose key is not a key of the
 * project files now has a stale mark. "Index the project" runs `scenity frames` as a job of the dev server; it draws
 * only the frames with no picture. A press on a frame picks it: one pick shows it large, two picks show them side by
 * side; "Before" compares a frame with the picture of the same place before a change.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { EmptyState, usePanelState } from "../../studio/extensions/api";
import {
  camerasOf,
  cellOf,
  pick,
  planName,
  plansOf,
  timesOf,
  type FrameIndexState,
  type FrameRow,
} from "./frameIndexModel";

const props = defineProps<{ base: string }>();
const { $t } = useI18n();
const state = shallowRef<FrameIndexState | null>(null);
const plan = usePanelState<string>("plan", "");
const picked = ref<string[]>([]);
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

const frames = computed(() => state.value?.frames ?? []);
const plans = computed(() => plansOf(frames.value));
const shown = computed(() => (plans.value.includes(plan.value) ? plan.value : (plans.value[0] ?? "")));
const cameras = computed(() => camerasOf(frames.value, shown.value));
const times = computed(() => timesOf(frames.value, shown.value));
const stale = computed(() => frames.value.filter((frame) => frame.stale).length);
/** A row for each camera, with the place of each time. */
const rows = computed(() =>
  cameras.value.map((camera) => ({
    camera,
    cells: times.value.map((time) => ({ time, cell: cellOf(frames.value, shown.value, camera, time) })),
  })),
);
const compared = computed(() =>
  picked.value
    .map((key) => frames.value.find((frame) => frame.key === key))
    .filter((frame): frame is FrameRow => frame !== undefined),
);

async function read(): Promise<void> {
  clearTimeout(timer);
  const response = await fetch(`${props.base}frames.json`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")) {
    state.value = (await response.json()) as FrameIndexState;
  }
  if (state.value?.running === true) timer = setTimeout(() => void read(), 1000);
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function index(): Promise<void> {
  const response = await fetch(`${props.base}frames.index`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1" },
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) note.value = response.message;
  else {
    const answer = (await response.json()) as { ok: boolean; reason?: string };
    note.value = answer.ok ? null : (answer.reason ?? null);
  }
  await read();
}

const url = (frame: FrameRow): string => `${props.base}frames/${frame.key}.png?made=${encodeURIComponent(frame.made)}`;
const label = (frame: FrameRow): string =>
  $t("frames-frame", { camera: frame.camera ?? $t("frames-scene-camera"), time: frame.time });
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-frameIndex')"
    data-testid="frame-index-panel"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <select
        v-if="plans.length > 0"
        v-model="plan"
        :aria-label="$t('frames-plan')"
        class="h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption"
        data-testid="frames-plan"
      >
        <option v-for="each in plans" :key="each" :value="each" translate="no">{{ planName(each) }}</option>
      </select>
      <span data-testid="frames-count">
        {{ $t("frames-count", { count: frames.length, wanted: state?.wanted ?? 0, stale }) }}
      </span>
      <Button size="sm" :disabled="state?.running === true" data-testid="frames-index" @click="index">
        {{ $t(state?.running === true ? "frames-running" : "frames-index") }}
      </Button>
      <span v-if="note !== null || state?.error" class="text-status-negative" role="alert">
        {{ note ?? state?.error }}
      </span>
    </div>
    <p v-if="state?.running === true && state.log.length > 0" class="font-mono text-text-secondary" translate="no">
      {{ state.log.at(-1) }}
    </p>
    <EmptyState v-if="state !== null && frames.length === 0" panel="frameIndex" />
    <div v-if="compared.length > 0" class="flex gap-1.5" data-testid="frames-compare">
      <figure v-for="frame in compared" :key="frame.key" class="flex min-w-0 flex-1 flex-col gap-0.5">
        <img :src="url(frame)" :alt="label(frame)" class="w-full rounded-control border border-border-subtle" />
        <figcaption class="flex items-center gap-1">
          <span translate="no">{{ planName(frame.plan) }}</span> · {{ label(frame) }}
          <span v-if="frame.stale" class="text-status-caution">{{ $t("frames-stale") }}</span>
        </figcaption>
      </figure>
    </div>
    <table v-if="frames.length > 0" class="border-separate border-spacing-1" data-testid="frames-grid">
      <thead>
        <tr>
          <th scope="col" class="text-left font-normal text-text-secondary">{{ $t("frames-camera") }}</th>
          <th v-for="time in times" :key="time" scope="col" class="text-left font-normal text-text-secondary">
            {{ $t("frames-time", { time }) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.camera ?? ''">
          <th scope="row" class="text-left font-normal" translate="no">
            {{ row.camera ?? $t("frames-scene-camera") }}
          </th>
          <td v-for="{ time, cell } in row.cells" :key="time" class="align-top">
            <template v-if="cell !== null">
              <div class="flex w-28 flex-col gap-0.5">
                <button
                  type="button"
                  :aria-pressed="picked.includes(cell.newest.key)"
                  :aria-label="label(cell.newest)"
                  :data-stale="cell.newest.stale || undefined"
                  :data-moment="cell.newest.moment || undefined"
                  class="overflow-hidden rounded-control border border-border-subtle aria-pressed:ring-2 aria-pressed:ring-accent-brand data-[stale]:border-status-caution"
                  data-testid="frames-cell"
                  @click="picked = pick(picked, cell.newest.key)"
                >
                  <img :src="url(cell.newest)" alt="" loading="lazy" class="aspect-video w-full object-cover" />
                </button>
                <div class="flex items-center gap-1">
                  <span v-if="cell.newest.moment" class="text-accent-brand" :title="$t('frames-moment')">◆</span>
                  <span v-if="cell.newest.stale" class="text-status-caution">{{ $t("frames-stale") }}</span>
                  <button
                    v-if="cell.before !== null"
                    type="button"
                    class="underline"
                    data-testid="frames-before"
                    @click="picked = [cell.before.key, cell.newest.key]"
                  >
                    {{ $t("frames-before") }}
                  </button>
                </div>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
