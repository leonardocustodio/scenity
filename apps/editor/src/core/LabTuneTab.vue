<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The tune tab of the 3D room lab: the tuned numbers of the scene, each with its default. The runtime registers these
 * numbers with `tunable` (`@scenity/runtime/tuning`). A change shows in the next frame, without a rebuild. The URL
 * keeps the changes (`tune=path:value`). "Copy changes" gives the changed numbers as text for the code, and
 * `labs tune-apply` writes them into the source. The prop nudge moves and turns a selected prop with keys. The Light
 * section changes the light.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The tune paths and the prop slots are data values.
 */
import { useI18n } from "@scenity/i18n";
import { tunables, tuneText, withTune } from "@scenity/runtime-dev";
import { cn } from "@scenity/ui";
import { RotateCcw } from "lucide-vue-next";
import { computed, ref } from "vue";
import LightSection from "./editor/LightSection.vue";
import { useLab } from "./labContext";
import { button, select } from "./labUi";
import { usePropNudge } from "./usePropNudge";

const { renderer } = useLab();
const { $t } = useI18n();
const tunes = renderer.tunes;
/** The tuned numbers and their defaults (the registry of this page; a change goes to the renderer). */
const all = tunables();
const search = ref("");
const shown = computed(() => {
  const words = search.value.trim().toLowerCase();
  return words === "" ? all : all.filter((item) => item.path.toLowerCase().includes(words));
});
const changed = computed(() => Object.keys(tunes.value).length);

const { props, prop, place } = usePropNudge(tunes);

/** Select a prop for the nudge keys and show its numbers in the list. */
function onProp(event: Event): void {
  const field = event.target as HTMLSelectElement;
  prop.value = field.value === "" ? null : field.value;
  search.value = prop.value === null ? "" : `room.props.${prop.value}.`;
  // The keys go to the scene, not to the field: a focused field takes the arrow keys.
  field.blur();
}

function valueOf(path: string, fallback: number): number {
  return tunes.value[path] ?? fallback;
}

function set(path: string, fallback: number, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) tunes.value = withTune(tunes.value, path, value, fallback);
}

function reset(path?: string): void {
  tunes.value = path === undefined ? {} : withTune(tunes.value, path, null);
}

/** "Copied" for a moment after "Copy changes". */
const copied = ref(false);

/** The changes as text: one line per number (default → value), then the URL parameter. */
async function copyChanges(): Promise<void> {
  const lines = all
    .filter((item) => item.path in tunes.value)
    .map((item) => `${item.path}: ${String(item.default)} → ${String(tunes.value[item.path])}`);
  const text = [...lines, "", `tune=${tuneText(tunes.value)}`].join("\n");
  await navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <div class="flex flex-col gap-3 text-caption">
    <p class="text-text-secondary">{{ $t("lab-tune-intro") }}</p>
    <div class="flex gap-1">
      <label for="lab-tune-search" class="flex-1">
        <span class="sr-only">{{ $t("lab-tune-search") }}</span>
        <input
          id="lab-tune-search"
          v-model="search"
          type="search"
          :placeholder="$t('lab-tune-search-placeholder')"
          :class="select"
        />
      </label>
      <button
        type="button"
        :class="cn(button, 'min-h-9 px-2.5 pointer-coarse:min-h-11')"
        :disabled="changed === 0"
        data-testid="lab-tune-copy"
        @click="copyChanges"
      >
        {{ copied ? $t("lab-tune-copied") : $t("lab-tune-copy", { count: String(changed) }) }}
      </button>
      <button
        type="button"
        :class="cn(button, 'inline-flex size-9 shrink-0 items-center justify-center p-0 pointer-coarse:size-11')"
        :aria-label="$t('lab-tune-reset-all')"
        :title="$t('lab-tune-reset-all')"
        :disabled="changed === 0"
        @click="reset()"
      >
        <RotateCcw class="size-4" aria-hidden="true" />
      </button>
    </div>
    <!-- The key light handle, the intensities and the colours of the light. -->
    <LightSection />
    <section class="flex flex-col gap-1.5" :aria-label="$t('lab-nudge')" data-testid="lab-prop-nudge">
      <h3 class="text-label text-text-secondary">{{ $t("lab-nudge") }}</h3>
      <label for="lab-nudge-prop" class="flex flex-col">
        <span class="sr-only">{{ $t("lab-nudge-prop") }}</span>
        <select id="lab-nudge-prop" :value="prop ?? ''" :class="select" data-testid="lab-nudge-prop" @change="onProp">
          <option value="">{{ $t("lab-nudge-none") }}</option>
          <option v-for="name in props" :key="name" :value="name" translate="no">{{ name }}</option>
        </select>
      </label>
      <p v-if="place !== null" class="font-mono tabular-nums" data-testid="lab-nudge-place">
        {{
          $t("lab-nudge-place", {
            x: place.x.toFixed(3),
            y: place.y.toFixed(3),
            z: place.z.toFixed(3),
            turn: place.yawDeg.toFixed(1),
          })
        }}
      </p>
      <p class="text-text-secondary">{{ $t("lab-nudge-keys") }}</p>
    </section>
    <ul class="m-0 flex list-none flex-col gap-1 p-0" data-testid="lab-tune-list">
      <li
        v-for="item in shown"
        :key="item.path"
        class="grid grid-cols-[1fr_6.5rem_auto] items-center gap-1"
        :data-changed="item.path in tunes || undefined"
      >
        <span class="truncate font-mono" :title="$t('lab-tune-default', { value: String(item.default) })">
          <span :class="item.path in tunes ? 'text-accent-brand' : 'text-text-secondary'" translate="no">{{
            item.path
          }}</span>
        </span>
        <input
          :id="`lab-tune-${item.path}`"
          :aria-label="item.path"
          type="number"
          :value="valueOf(item.path, item.default)"
          :step="item.step"
          :class="cn(select, 'font-mono tabular-nums')"
          @change="set(item.path, item.default, $event)"
        />
        <button
          type="button"
          :class="
            cn(button, 'inline-flex size-9 items-center justify-center p-0', !(item.path in tunes) && 'invisible')
          "
          :aria-label="$t('lab-tune-reset', { path: item.path })"
          @click="reset(item.path)"
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
