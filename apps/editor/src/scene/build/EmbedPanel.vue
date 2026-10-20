<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The player preview and the embed snippets. The panel shows the player options (the scene, the sequence, the camera,
 * the tier, the backend, autoplay, loop, muted). It shows the built player with these options in a frame (the page of
 * the web component snippet). It also shows the snippets for the web component, a script tag and Vue, with Copy. The
 * base is the URL of the build folder: the folder of the dev server, or the URL where the person serves the build.
 */
import { useI18n } from "@scenity/i18n";
import { RENDER_BACKENDS, RENDER_TIERS } from "@scenity/scene/schema/editor";
import { Button, Toggle } from "@scenity/ui";
import { computed, ref } from "vue";
import { embedSnippet, SNIPPET_KINDS, type EmbedOptions, type SnippetKind } from "./embedSnippet";

const props = defineProps<{ base: string; scenes: () => readonly string[] }>();
const { $t } = useI18n();
const out = ref("dist");
const publicBase = ref("");
const scene = ref("");
const sequence = ref("");
const camera = ref("");
const tier = ref("");
const backend = ref("");
const autoplay = ref(true);
const loop = ref(false);
const muted = ref(true);
const kind = ref<SnippetKind>("element");
const copied = ref(false);
const preview = ref(0);

/** The URL of the build folder on this server. */
const local = computed(() => new URL(`${props.base}${out.value.replace(/\/$/, "")}/`, location.origin).toString());
const options = computed<EmbedOptions>(() => ({
  base: publicBase.value.trim() === "" ? local.value : publicBase.value.trim().replace(/\/?$/, "/"),
  ...{ scene: scene.value, sequence: sequence.value, camera: camera.value, tier: tier.value, backend: backend.value },
  ...{ autoplay: autoplay.value, loop: loop.value, muted: muted.value },
}));
const snippet = computed(() => embedSnippet(kind.value, options.value));
// The preview plays the build of this server with the options (a plain page of the dev server).
const page = computed(() => {
  const rest = Object.fromEntries(Object.entries(options.value).filter(([key]) => key !== "base"));
  return `${props.base}embed.preview.html?${new URLSearchParams({ out: out.value, options: JSON.stringify(rest) }).toString()}`;
});

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(snippet.value).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-3 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-embed')"
    data-testid="embed-panel"
  >
    <form class="flex w-72 shrink-0 flex-col gap-1" @submit.prevent>
      <label class="flex items-center gap-1" for="embed-out">
        <span class="w-24 shrink-0">{{ $t("build-out") }}</span>
        <input id="embed-out" v-model="out" :class="[input, 'flex-1 font-mono']" data-testid="embed-out" />
      </label>
      <label class="flex items-center gap-1" for="embed-base">
        <span class="w-24 shrink-0">{{ $t("embed-base") }}</span>
        <input
          id="embed-base"
          v-model="publicBase"
          :placeholder="local"
          :class="[input, 'min-w-0 flex-1 font-mono']"
          translate="no"
          data-testid="embed-base"
        />
      </label>
      <label class="flex items-center gap-1" for="embed-scene">
        <span class="w-24 shrink-0">{{ $t("embed-scene") }}</span>
        <select id="embed-scene" v-model="scene" :class="[input, 'min-w-0 flex-1']" data-testid="embed-scene">
          <option value="">{{ $t("embed-default") }}</option>
          <option v-for="each in scenes()" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1" for="embed-sequence">
        <span class="w-24 shrink-0">{{ $t("embed-sequence") }}</span>
        <input
          id="embed-sequence"
          v-model="sequence"
          :class="[input, 'flex-1 font-mono']"
          data-testid="embed-sequence"
        />
      </label>
      <label class="flex items-center gap-1" for="embed-camera">
        <span class="w-24 shrink-0">{{ $t("embed-camera") }}</span>
        <input id="embed-camera" v-model="camera" :class="[input, 'flex-1 font-mono']" data-testid="embed-camera" />
      </label>
      <label class="flex items-center gap-1" for="embed-tier">
        <span class="w-24 shrink-0">{{ $t("perf-tier") }}</span>
        <select id="embed-tier" v-model="tier" :class="input" data-testid="embed-tier">
          <option value="">{{ $t("embed-default") }}</option>
          <option v-for="each in RENDER_TIERS" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1" for="embed-backend">
        <span class="w-24 shrink-0">{{ $t("perf-backend") }}</span>
        <select id="embed-backend" v-model="backend" :class="input" data-testid="embed-backend">
          <option value="">{{ $t("embed-default") }}</option>
          <option v-for="each in RENDER_BACKENDS" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
      </label>
      <div class="flex flex-wrap gap-2">
        <label class="flex items-center gap-1" for="embed-autoplay">
          <input id="embed-autoplay" v-model="autoplay" type="checkbox" data-testid="embed-autoplay" />
          {{ $t("embed-autoplay") }}
        </label>
        <label class="flex items-center gap-1" for="embed-loop">
          <input id="embed-loop" v-model="loop" type="checkbox" data-testid="embed-loop" />
          {{ $t("embed-loop") }}
        </label>
        <label class="flex items-center gap-1" for="embed-muted">
          <input id="embed-muted" v-model="muted" type="checkbox" data-testid="embed-muted" />
          {{ $t("embed-muted") }}
        </label>
      </div>
      <div class="flex gap-0.5" role="group" :aria-label="$t('embed-kinds')">
        <Toggle
          v-for="each in SNIPPET_KINDS"
          :key="each"
          size="sm"
          class="h-6 px-1.5 text-caption"
          :model-value="kind === each"
          :data-testid="`embed-kind-${each}`"
          @update:model-value="kind = each"
          >{{ $t(`embed-kind-${each}`) }}</Toggle
        >
      </div>
      <pre
        class="max-h-48 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono text-[0.6875rem] whitespace-pre-wrap"
        translate="no"
        data-testid="embed-snippet"
        >{{ snippet }}</pre>
      <Button size="sm" class="self-start" data-testid="embed-copy" @click="copy">
        {{ copied ? $t("embed-copied") : $t("embed-copy") }}
      </Button>
    </form>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex items-center gap-2">
        <h3 class="font-medium">{{ $t("embed-preview") }}</h3>
        <Button size="sm" variant="ghost" data-testid="embed-reload" @click="preview += 1">{{
          $t("embed-reload")
        }}</Button>
      </div>
      <iframe
        :key="preview"
        :src="page"
        :title="$t('embed-preview')"
        class="aspect-video w-full rounded-control border border-border-subtle bg-surface-sunken"
        data-testid="embed-frame"
      />
    </div>
  </section>
</template>
