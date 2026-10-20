<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The error boundary of a contribution of a plugin. It loads the component of the contribution on the first use. An
 * error of the load or of a render shows an error card in its place, with the plugin, the error and Try again. The
 * editor continues to work. Each error goes to `failed`, and the Console and Problems of the page show it. Three
 * errors in a row of one contribution disable it in each place where it shows (contributionErrors.ts). The card tells
 * this, and "Turn on" starts it again.
 */
import { useI18n } from "@scenity/i18n";
import { computed, defineAsyncComponent, markRaw, onErrorCaptured, ref, shallowRef, type Component } from "vue";
import type { LazyComponent, StudioContext } from "./api";
import { contributionErrors, MAX_ERRORS } from "./contributionErrors";

const props = defineProps<{
  load: LazyComponent;
  ctx: StudioContext;
  /** The contribution (its ID), for the card. */
  name: string;
  failed?: (name: string, error: unknown) => void;
  /** More props of the component (a widget: its value, its label and its set). */
  extra?: Readonly<Record<string, unknown>>;
}>();
const { $t } = useI18n();
const error = ref<string | null>(null);
const tries = ref(0);
const loaded = shallowRef<Component | null>(null);
const key = `${props.ctx.plugin}:${props.name}`;
const off = computed(() => (contributionErrors.get(key) ?? 0) >= MAX_ERRORS);

function fail(reason: unknown): void {
  error.value = reason instanceof Error ? reason.message : String(reason);
  contributionErrors.set(key, (contributionErrors.get(key) ?? 0) + 1);
  props.failed?.(props.name, reason);
}

function start(): void {
  loaded.value = markRaw(
    defineAsyncComponent({
      loader: async (): Promise<Component> => {
        const module: { readonly default: Component } | Component = await props.load();
        return typeof module === "object" && "default" in module ? (module.default as Component) : module;
      },
      onError: (reason, _retry, stop) => {
        fail(reason);
        stop();
      },
    }),
  );
}
start();

onErrorCaptured((reason) => {
  fail(reason);
  return false;
});

function again(): void {
  error.value = null;
  tries.value += 1;
  start();
}

/** Start a contribution that three errors disabled. */
function turnOn(): void {
  contributionErrors.delete(key);
  again();
}
</script>

<template>
  <div
    v-if="off"
    class="m-1.5 flex flex-col gap-1 rounded-control border border-status-negative p-1.5 text-caption text-text-primary"
    role="alert"
    data-testid="contribution-off"
    :data-contribution="name"
  >
    <span class="font-semibold">{{ $t("plugin-error-off", { plugin: ctx.plugin, name, count: MAX_ERRORS }) }}</span>
    <span v-if="error !== null" class="font-mono text-text-secondary" translate="no">{{ error }}</span>
    <button
      type="button"
      class="self-start rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised"
      data-testid="contribution-on"
      @click="turnOn"
    >
      {{ $t("plugin-error-on") }}
    </button>
  </div>
  <div
    v-else-if="error !== null"
    class="m-1.5 flex flex-col gap-1 rounded-control border border-status-negative p-1.5 text-caption text-text-primary"
    role="alert"
    data-testid="contribution-error"
    :data-contribution="name"
  >
    <span class="font-semibold">{{ $t("plugin-error-title", { plugin: ctx.plugin, name }) }}</span>
    <span class="font-mono text-text-secondary" translate="no">{{ error }}</span>
    <button
      type="button"
      class="self-start rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised"
      data-testid="contribution-again"
      @click="again"
    >
      {{ $t("plugin-error-again") }}
    </button>
  </div>
  <component :is="loaded" v-else-if="loaded !== null" :key="tries" :ctx="ctx" v-bind="extra ?? {}" />
</template>
