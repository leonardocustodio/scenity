<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Shots panel. A shot of a scene (its camera, a time, a size, a backend) is a job of the dev server. The panel
 * shows the shots with "Add as a baseline" (the owner confirms) and "Set as the poster", and the baselines of the
 * platform. Run verify (`scenity verify` as a job) gives the result of each baseline. For a failed baseline, the panel
 * shows its actual picture over the baseline with a difference overlay.
 */
import { useI18n } from "@scenity/i18n";
import { RENDER_BACKENDS } from "@scenity/scene/schema/editor";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { t } from "../../texts";
import type { ScenePageEditor } from "../sceneEditor";
import { posterValue, sceneOfName, shotParts } from "./shotNames";

interface Job {
  readonly running: boolean;
  readonly log: readonly string[];
  readonly code: number | null;
}
interface ShotsState {
  readonly platform: string;
  readonly baselines: readonly { readonly scene: string; readonly camera: string; readonly file: string }[];
  readonly shots: readonly string[];
  readonly shot: Job;
  readonly verify: Job & {
    readonly steps: readonly { name: string; passed: boolean }[];
    readonly summary: string | null;
  };
}

const props = defineProps<{ base: string; editor: ScenePageEditor; scenes: () => readonly string[] }>();
const { $t } = useI18n();
const state = shallowRef<ShotsState | null>(null);
const scene = ref(props.editor.file.path);
const camera = ref("");
const at = ref("");
const size = ref("1280x800");
const backend = ref("");
const confirm = ref<string | null>(null);
const note = ref<string | null>(null);
const showDiff = ref(true);
const version = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;

async function read(): Promise<void> {
  clearTimeout(timer);
  const response = await fetch(`${props.base}shots.json`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")) {
    const before = state.value;
    state.value = (await response.json()) as ShotsState;
    if (before !== null && (before.shot.running || before.verify.running)) version.value += 1;
  }
  if (state.value?.shot.running === true || state.value?.verify.running === true)
    timer = setTimeout(() => void read(), 1000);
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function post(path: string, body: unknown): Promise<{ ok: boolean; reason?: string; path?: string }> {
  const response = await fetch(`${props.base}${path}`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) return { ok: false, reason: response.message };
  return (await response.json()) as { ok: boolean; reason?: string; path?: string };
}

/** The cameras of the open scene (a camera component), for a shot of the open scene. */
const cameras = computed(() =>
  scene.value === props.editor.file.path
    ? Object.entries(props.editor.doc.entities)
        .filter(([, entity]) => entity.components.camera !== undefined)
        .map(([id]) => id)
    : [],
);

async function take(): Promise<void> {
  const time = at.value.trim() === "" ? undefined : Number(at.value);
  const answer = await post("shots.take", {
    ...{ scene: scene.value, camera: camera.value, size: size.value, backend: backend.value },
    ...(time === undefined ? {} : { at: time }),
  });
  note.value = answer.ok ? null : (answer.reason ?? null);
  await read();
}

async function baseline(file: string): Promise<void> {
  if (confirm.value !== file) {
    confirm.value = file;
    return;
  }
  confirm.value = null;
  const parts = shotParts(file);
  const sceneFile = parts === null ? null : sceneOfName(props.scenes(), parts.scene);
  const answer = await post("shots.baseline", {
    file,
    scene: sceneFile,
    camera: parts?.camera === "scene" ? "" : parts?.camera,
  });
  note.value = answer.ok ? $t("shots-baseline-added", { path: answer.path ?? "" }) : (answer.reason ?? null);
  await read();
}

async function poster(file: string): Promise<void> {
  const parts = shotParts(file);
  const sceneFile = parts === null ? null : sceneOfName(props.scenes(), parts.scene);
  const answer = await post("shots.poster", { file, scene: sceneFile });
  if (!answer.ok || sceneFile === null || answer.path === undefined) {
    note.value = answer.reason ?? null;
    return;
  }
  // The open scene names its new poster in one undo step; the save writes it.
  const failed =
    sceneFile === props.editor.file.path
      ? props.editor.apply(
          [{ op: "set", path: "/poster", value: posterValue(sceneFile, answer.path) }],
          t("shots-poster-title"),
        )
      : null;
  note.value = failed ?? $t("shots-poster-set", { path: answer.path });
}

async function verify(): Promise<void> {
  const answer = await post("shots.verify", {});
  note.value = answer.ok ? null : (answer.reason ?? null);
  await read();
}

const url = (path: string): string => `${props.base}${path}?v=${String(version.value)}`;
const stepOf = (file: string) => state.value?.verify.steps.find((step) => file.endsWith(`/${step.name}`)) ?? null;
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-baselines')"
    data-testid="shots-panel"
  >
    <form class="flex flex-wrap items-center gap-1" @submit.prevent="take">
      <select v-model="scene" :class="input" :aria-label="$t('embed-scene')" data-testid="shots-scene">
        <option v-for="each in scenes()" :key="each" :value="each" translate="no">{{ each }}</option>
      </select>
      <input
        v-model="camera"
        list="shots-cameras"
        :placeholder="$t('shots-camera')"
        :aria-label="$t('shots-camera')"
        :class="[input, 'w-28 font-mono']"
        data-testid="shots-camera"
      />
      <datalist id="shots-cameras">
        <option v-for="id in cameras" :key="id" :value="id" />
      </datalist>
      <input
        v-model="at"
        :placeholder="$t('shots-at')"
        :aria-label="$t('shots-at')"
        :class="[input, 'w-20']"
        data-testid="shots-at"
      />
      <input
        v-model="size"
        :aria-label="$t('shots-size')"
        :class="[input, 'w-24 font-mono']"
        data-testid="shots-size"
      />
      <select v-model="backend" :class="input" :aria-label="$t('perf-backend')" data-testid="shots-backend">
        <option value="">{{ $t("embed-default") }}</option>
        <option v-for="each in RENDER_BACKENDS" :key="each" :value="each" translate="no">{{ each }}</option>
      </select>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        :disabled="state?.shot.running === true"
        data-testid="shots-take"
      >
        {{ state?.shot.running === true ? $t("shots-taking") : $t("shots-take") }}
      </Button>
      <Button size="sm" :disabled="state?.verify.running === true" data-testid="shots-verify" @click="verify">
        {{ state?.verify.running === true ? $t("shots-verifying") : $t("shots-verify") }}
      </Button>
      <span
        v-if="state?.verify.summary"
        :class="state.verify.code === 0 ? 'text-status-positive' : 'text-status-negative'"
        :data-code="state.verify.code"
        translate="no"
        data-testid="shots-verify-result"
        >{{ state.verify.summary }}</span
      >
    </form>
    <p v-if="note !== null" class="text-text-secondary" role="status" data-testid="shots-note">{{ note }}</p>
    <h3 class="font-medium">{{ $t("shots-shots") }}</h3>
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-1.5">
      <li
        v-for="file in state?.shots ?? []"
        :key="file"
        class="flex flex-col gap-0.5"
        :data-file="file"
        data-testid="shots-shot"
      >
        <img :src="url(file)" alt="" class="aspect-video w-full rounded-control bg-surface-sunken object-contain" />
        <span class="truncate font-mono" translate="no">{{ file.slice(file.lastIndexOf("/") + 1) }}</span>
        <span class="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" data-testid="shots-baseline" @click="baseline(file)">
            {{ confirm === file ? $t("shots-baseline-confirm") : $t("shots-baseline") }}
          </Button>
          <Button size="sm" variant="ghost" data-testid="shots-poster" @click="poster(file)">{{
            $t("shots-poster")
          }}</Button>
        </span>
      </li>
    </ul>
    <h3 class="font-medium">{{ $t("shots-baselines", { platform: state?.platform ?? "" }) }}</h3>
    <label class="flex items-center gap-1" for="shots-diff">
      <input id="shots-diff" v-model="showDiff" type="checkbox" data-testid="shots-diff-toggle" />
      {{ $t("shots-diff") }}
    </label>
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-1.5">
      <li
        v-for="item in state?.baselines ?? []"
        :key="item.file"
        class="flex flex-col gap-0.5"
        :data-file="item.file"
        :data-result="stepOf(item.file) === null ? undefined : stepOf(item.file)?.passed ? 'pass' : 'fail'"
        data-testid="shots-baseline-item"
      >
        <div class="relative aspect-video w-full overflow-hidden rounded-control bg-surface-sunken">
          <img :src="url(item.file)" alt="" class="absolute inset-0 size-full object-contain" />
          <img
            v-if="stepOf(item.file)?.passed === false && showDiff"
            :src="url(`test-results/verify/${item.file.slice(item.file.lastIndexOf('/') + 1)}`)"
            alt=""
            class="absolute inset-0 size-full object-contain mix-blend-difference"
            data-testid="shots-diff"
          />
        </div>
        <span class="flex gap-1">
          <span class="min-w-0 flex-1 truncate font-mono" translate="no">{{ item.scene }} · {{ item.camera }}</span>
          <span
            v-if="stepOf(item.file) !== null"
            :class="stepOf(item.file)?.passed ? 'text-status-positive' : 'text-status-negative'"
          >
            {{ stepOf(item.file)?.passed ? $t("shots-same") : $t("shots-differs") }}
          </span>
        </span>
      </li>
    </ul>
  </section>
</template>
