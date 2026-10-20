<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The render queue. The panel has the form of a contact sheet (a time range and its step, the cameras, the cell width)
 * or of a clip (a time range, a camera, the frames per second, the size) of a sequence. It shows the queue of the dev
 * server (one run at a time under the GPU lock) with the state of each item, and the gallery of the outputs.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Toggle } from "@scenity/ui";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";

interface QueueItem {
  readonly id: number;
  readonly request: { readonly kind: string; readonly sequence: string; readonly from: number; readonly to: number };
  readonly state: string;
  readonly output: string;
  readonly log: readonly string[];
}

const props = defineProps<{ base: string; sequences: () => readonly string[] }>();
const { $t } = useI18n();
const kind = ref<"sheet" | "clip">("clip");
const sequence = ref(props.sequences()[0] ?? "");
const camera = ref("");
const from = ref("0");
const to = ref("1000");
const step = ref("250");
const cell = ref("320");
const fps = ref("12");
const size = ref("640x400");
const queue = shallowRef<readonly QueueItem[]>([]);
const outputs = shallowRef<readonly string[]>([]);
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

async function read(): Promise<void> {
  clearTimeout(timer);
  const response = await fetch(`${props.base}render.json`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")) {
    const state = (await response.json()) as { queue: QueueItem[]; outputs: string[] };
    queue.value = state.queue;
    outputs.value = state.outputs;
  }
  if (queue.value.some((item) => item.state === "waiting" || item.state === "running")) {
    timer = setTimeout(() => void read(), 1000);
  }
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function add(): Promise<void> {
  const number = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text));
  const body = {
    ...{ kind: kind.value, sequence: sequence.value, from: number(from.value), to: number(to.value) },
    ...(camera.value.trim() === "" ? {} : { camera: camera.value.trim() }),
    ...(kind.value === "sheet"
      ? { step: number(step.value), cell: number(cell.value) }
      : { fps: number(fps.value), size: size.value }),
  };
  const response = await fetch(`${props.base}render.add`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) note.value = response.message;
  else {
    const answer = (await response.json()) as { ok: boolean; reason?: string };
    note.value = answer.ok ? null : (answer.reason ?? null);
  }
  await read();
}

const MARK: Readonly<Record<string, string>> = {
  waiting: "text-text-secondary",
  running: "text-status-caution",
  done: "text-status-positive",
  failed: "text-status-negative",
};
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-3 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-renderQueue')"
    data-testid="render-panel"
  >
    <form class="flex w-72 shrink-0 flex-col gap-1" @submit.prevent="add">
      <div class="flex gap-0.5" role="group" :aria-label="$t('render-kind')">
        <Toggle
          v-for="each in ['clip', 'sheet'] as const"
          :key="each"
          size="sm"
          class="h-6 px-1.5 text-caption"
          :model-value="kind === each"
          :data-testid="`render-kind-${each}`"
          @update:model-value="kind = each"
          >{{ $t(`render-kind-${each}`) }}</Toggle
        >
      </div>
      <label class="flex items-center gap-1" for="render-sequence">
        <span class="w-20 shrink-0">{{ $t("embed-sequence") }}</span>
        <select
          id="render-sequence"
          v-model="sequence"
          :class="[input, 'min-w-0 flex-1']"
          data-testid="render-sequence"
        >
          <option v-for="each in sequences()" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1" for="render-camera">
        <span class="w-20 shrink-0">{{ $t("embed-camera") }}</span>
        <input id="render-camera" v-model="camera" :class="[input, 'flex-1 font-mono']" data-testid="render-camera" />
      </label>
      <div class="flex items-center gap-1">
        <span class="w-20 shrink-0">{{ $t("render-range") }}</span>
        <input v-model="from" :aria-label="$t('rules-edit-from')" :class="[input, 'w-16']" data-testid="render-from" />
        <input v-model="to" :aria-label="$t('rules-edit-to')" :class="[input, 'w-16']" data-testid="render-to" />
      </div>
      <template v-if="kind === 'sheet'">
        <label class="flex items-center gap-1" for="render-step">
          <span class="w-20 shrink-0">{{ $t("rules-edit-step") }}</span>
          <input id="render-step" v-model="step" :class="[input, 'w-16']" data-testid="render-step" />
        </label>
        <label class="flex items-center gap-1" for="render-cell">
          <span class="w-20 shrink-0">{{ $t("render-cell") }}</span>
          <input id="render-cell" v-model="cell" :class="[input, 'w-16']" data-testid="render-cell" />
        </label>
      </template>
      <template v-else>
        <label class="flex items-center gap-1" for="render-fps">
          <span class="w-20 shrink-0">{{ $t("render-fps") }}</span>
          <input id="render-fps" v-model="fps" :class="[input, 'w-16']" data-testid="render-fps" />
        </label>
        <label class="flex items-center gap-1" for="render-size">
          <span class="w-20 shrink-0">{{ $t("shots-size") }}</span>
          <input id="render-size" v-model="size" :class="[input, 'w-24 font-mono']" data-testid="render-size" />
        </label>
      </template>
      <Button size="sm" variant="primary" type="submit" class="self-start" data-testid="render-add">
        {{ $t("render-add") }}
      </Button>
      <p v-if="note !== null" class="text-status-negative" role="alert">{{ note }}</p>
      <h3 class="mt-1 font-medium">{{ $t("render-queue") }}</h3>
      <ul class="flex flex-col gap-0.5">
        <li v-for="item in queue" :key="item.id" :data-state="item.state" data-testid="render-item">
          <span translate="no"
            >{{ item.request.kind }} · {{ item.request.sequence }} · {{ item.request.from }}–{{ item.request.to }}</span
          >
          <span :class="['ml-1', MARK[item.state]]">{{ $t(`render-state-${item.state}`) }}</span>
        </li>
      </ul>
    </form>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h3 class="font-medium">{{ $t("render-outputs") }}</h3>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-1.5">
        <li
          v-for="file in outputs"
          :key="file"
          class="flex flex-col gap-0.5"
          :data-file="file"
          data-testid="render-output"
        >
          <video
            v-if="file.endsWith('.webm')"
            :src="`${base}${file}`"
            controls
            muted
            class="aspect-video w-full rounded-control bg-surface-sunken"
          />
          <img v-else :src="`${base}${file}`" alt="" class="w-full rounded-control bg-surface-sunken object-contain" />
          <a
            :href="`${base}${file}`"
            target="_blank"
            rel="noopener"
            class="truncate font-mono text-text-link"
            translate="no"
          >
            {{ file.slice(file.lastIndexOf("/") + 1) }}
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>
