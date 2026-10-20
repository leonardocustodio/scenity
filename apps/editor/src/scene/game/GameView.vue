<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Game view panel: the play page of the player in a frame, with the toolbar of its
 * options (gameView.ts). A change of an option or Refresh gives the frame a new handoff of the documents now. The
 * options go into the state of the panel, so the layout keeps them. The frame runs its player only while the tab of
 * the view shows: a Game view behind another tab has no frame, so it takes no time from the Scene view (the play mode
 * in the Scene view replays to the same frames). It gets the documents now when it shows again.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { usePanelState, usePanelVisible } from "../../studio/shell/panelState";
import { DEFAULT_GAME, fitFrame, RESOLUTIONS, statsLine, type GameOptions } from "./gameView";

const props = defineProps<{
  /** The URL of the play page for the options with the documents now, or null. */
  url(options: GameOptions): string | null;
  /** The document cameras (ID and name). */
  cameras(): readonly { readonly id: string; readonly label: string }[];
  /** Call `listener` when the view must show the documents again (the start of the play mode); the result stops it. */
  listen(listener: () => void): () => void;
}>();
const { $t } = useI18n();

const options = usePanelState<GameOptions>("game", DEFAULT_GAME);
const src = ref<string | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
const stats = ref<ReturnType<typeof statsLine> | null>(null);

const visible = usePanelVisible();
function refresh(): void {
  src.value = visible.value ? props.url(options.value) : null;
}
watch(visible, () => refresh());

/** The value of the camera choice "the first camera" (a select item needs a value that is not empty). */
const FIRST = "*first";

const set = <K extends keyof GameOptions>(key: K, value: GameOptions[K]): void => {
  options.value = { ...options.value, [key]: value };
};
const cameraOptions = computed(() => [
  { value: FIRST, label: $t("game-camera-first") },
  ...props.cameras().map((camera) => ({ value: camera.id, label: camera.label })),
]);
const resolutionOptions = computed(() =>
  RESOLUTIONS.map((item) => ({
    value: item.id,
    label: item.id === "free" ? $t("game-resolution-free") : item.id.replace("x", " × "),
  })),
);
const TIERS = ["ultra", "high", "medium", "low"];
/** The label of a quality tier (an unknown tier shows as it is). */
const tierLabel = (tier: string): string => (TIERS.includes(tier) ? $t(`lab-tier-${tier}`) : tier);
const tierOptions = computed(() => TIERS.map((value) => ({ value, label: tierLabel(value) })));
const backendOptions = computed(() => [
  { value: "auto", label: $t("game-backend-auto") },
  { value: "webgl", label: "WebGL" },
  { value: "webgpu", label: "WebGPU" },
]);
const fitted = computed(() => fitFrame(options.value.resolution, size.value));
const ids = { worker: useId(), stats: useId() };

watch(
  () => [options.value.camera, options.value.tier, options.value.backend, options.value.worker],
  () => refresh(),
);

let resize: ResizeObserver | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let stop: (() => void) | null = null;
onMounted(() => {
  const element = stage.value;
  if (element !== null) {
    const measure = (): void => {
      size.value = { width: element.clientWidth, height: element.clientHeight };
    };
    measure();
    resize = new ResizeObserver(measure);
    resize.observe(element);
  }
  stop = props.listen(refresh);
  refresh();
  poll = setInterval(() => {
    if (!options.value.stats) return;
    const player = (
      frame.value?.contentWindow as
        (Window & { __scenityPlay?: { stats(): Promise<Parameters<typeof statsLine>[0]> } }) | null
    )?.__scenityPlay;
    void player
      ?.stats()
      .then((value) => {
        stats.value = statsLine(value);
      })
      .catch(() => undefined);
  }, 1000);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  if (poll !== null) clearInterval(poll);
  stop?.();
});
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-game-view')"
    data-testid="game-view"
  >
    <div class="flex flex-wrap items-center gap-1 border-b border-border-subtle p-1">
      <Select
        :model-value="options.camera ?? FIRST"
        :options="cameraOptions"
        class="w-36"
        :aria-label="$t('game-camera')"
        @update:model-value="(value: string) => set('camera', value === FIRST ? null : value)"
      />
      <Select
        :model-value="options.resolution"
        :options="resolutionOptions"
        class="w-32"
        :aria-label="$t('game-resolution')"
        @update:model-value="(value: string) => set('resolution', value as GameOptions['resolution'])"
      />
      <Select
        :model-value="options.tier"
        :options="tierOptions"
        class="w-24"
        :aria-label="$t('game-tier')"
        @update:model-value="(value: string) => set('tier', value as GameOptions['tier'])"
      />
      <Select
        :model-value="options.backend"
        :options="backendOptions"
        class="w-28"
        :aria-label="$t('game-backend')"
        @update:model-value="(value: string) => set('backend', value as GameOptions['backend'])"
      />
      <label class="flex items-center gap-1" :for="ids.worker">
        <input
          :id="ids.worker"
          type="checkbox"
          :checked="options.worker"
          data-testid="game-worker"
          @change="set('worker', ($event.target as HTMLInputElement).checked)"
        />{{ $t("game-worker") }}
      </label>
      <label class="flex items-center gap-1" :for="ids.stats">
        <input
          :id="ids.stats"
          type="checkbox"
          :checked="options.stats"
          data-testid="game-stats-switch"
          @change="set('stats', ($event.target as HTMLInputElement).checked)"
        />{{ $t("game-stats") }}
      </label>
      <Button size="sm" variant="ghost" data-testid="game-refresh" @click="refresh">{{ $t("game-refresh") }}</Button>
    </div>
    <div ref="stage" class="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <iframe
        v-if="src !== null"
        ref="frame"
        :src="src"
        :width="fitted.width"
        :height="fitted.height"
        :title="$t('panel-game-view')"
        class="block border-0"
        data-testid="game-frame"
        :data-resolution="options.resolution"
      />
      <p v-else class="text-text-secondary">{{ $t("game-none") }}</p>
      <p
        v-if="options.stats && stats !== null"
        class="absolute left-1 top-1 rounded-control bg-surface-overlay px-1"
        data-testid="game-stats"
      >
        {{
          $t("game-stats-line", {
            fps: stats.fps ?? 0,
            draws: stats.drawCalls,
            triangles: stats.triangles,
            tier: tierLabel(stats.tier),
            mode: stats.mode,
          })
        }}
      </p>
    </div>
  </section>
</template>
