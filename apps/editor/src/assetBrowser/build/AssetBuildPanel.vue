<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The asset build panel: the build state of each asset (built, stale, unbuilt, failed), Run the build, and the build
 * settings of the selected asset. Run the build starts `scenity assets build` as a job of the dev server, with its
 * log. The build settings are the texture codecs and the levels of detail, with a preview of each level of the build.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { AssetSource } from "../assetClient";
import type { AssetBuildReport } from "../assetTypes";
import LivePreview from "../preview/LivePreview.vue";
import { CODEC_ROLES, CODECS, formSettings, formTexts, stateCounts, type BuildFormTexts } from "./buildForm";

const props = defineProps<{ source: AssetSource }>();
const { $t } = useI18n();
const report = shallowRef<AssetBuildReport | null>(null);
const selectedId = ref<string | null>(null);
const selected = computed(() => report.value?.assets.find((asset) => asset.id === selectedId.value) ?? null);
const texts = ref<BuildFormTexts>(formTexts(null));
const tier = ref<string | null>(null);
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** Read the report. While the build runs, read it again each second. */
async function read(): Promise<void> {
  clearTimeout(timer);
  report.value = (await props.source.build?.()) ?? null;
  if (report.value?.job.running === true) timer = setTimeout(() => void read(), 1000);
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));
watch(selectedId, () => {
  texts.value = formTexts(selected.value?.build ?? null);
  tier.value = null;
});

async function run(): Promise<void> {
  const result = await props.source.runBuild?.();
  note.value = result === undefined || result.ok ? null : result.reason;
  await read();
}

async function save(): Promise<void> {
  const asset = selected.value;
  if (asset === null || props.source.writeBuildSettings === undefined) return;
  let build;
  try {
    build = formSettings(texts.value);
  } catch {
    note.value = $t("asset-build-lods-bad");
    return;
  }
  const result = await props.source.writeBuildSettings(asset.id, build);
  note.value = result.ok ? $t("asset-build-saved") : result.reason;
  await read();
}

const counts = computed(() => stateCounts(report.value?.assets ?? []));
const log = computed(() => (report.value?.job.log ?? []).slice(-12).join("\n"));
const MARK: Readonly<Record<string, string>> = {
  built: "text-status-positive",
  stale: "text-status-caution",
  unbuilt: "text-text-secondary",
  failed: "text-status-negative",
};
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col text-caption text-text-primary"
    :aria-label="$t('asset-build')"
    data-testid="asset-build"
  >
    <header class="flex flex-wrap items-center gap-2 border-b border-border-subtle px-1.5 py-1">
      <Button
        size="sm"
        variant="primary"
        :disabled="report?.job.running === true || source.runBuild === undefined"
        data-testid="asset-build-run"
        @click="run"
      >
        {{ report?.job.running === true ? $t("asset-build-running") : $t("asset-build-run") }}
      </Button>
      <span v-for="[state, count] in counts" :key="state" :class="MARK[state]" :data-count-state="state">
        {{ $t(`asset-build-count-${state}`, { count }) }}
      </span>
      <span
        v-if="report !== null && report.job.code !== null && !report.job.running"
        :class="report.job.code === 0 ? 'text-status-positive' : 'text-status-negative'"
        data-testid="asset-build-result"
        :data-code="report.job.code"
      >
        {{ report.job.code === 0 ? $t("asset-build-ok") : $t("asset-build-failed") }}
      </span>
      <p v-if="note !== null" class="text-text-secondary" role="status">{{ note }}</p>
    </header>
    <pre
      v-if="log !== ''"
      class="max-h-28 shrink-0 overflow-auto border-b border-border-subtle bg-surface-sunken p-1.5 font-mono text-[0.6875rem]"
      translate="no"
      data-testid="asset-build-log"
      >{{ log }}</pre>
    <div class="flex min-h-0 flex-1">
      <ul class="min-h-0 flex-1 overflow-auto p-1" :aria-label="$t('asset-build-assets')">
        <li v-for="asset in report?.assets ?? []" :key="asset.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-left hover:bg-surface-raised"
            :class="selectedId === asset.id && 'bg-accent-brand/15'"
            :aria-pressed="selectedId === asset.id"
            :title="asset.reason ?? undefined"
            :data-state="asset.state"
            :data-testid="`asset-build-row-${asset.id}`"
            @click="selectedId = asset.id"
          >
            <span class="min-w-0 flex-1 truncate" translate="no">{{ asset.name }}</span>
            <span class="text-text-secondary" translate="no">{{ asset.kind }}</span>
            <span class="w-16 text-right" :class="MARK[asset.state]" data-testid="asset-build-mark">
              {{ $t(`asset-build-state-${asset.state}`) }}
            </span>
          </button>
        </li>
      </ul>
      <aside
        v-if="selected !== null"
        class="flex w-72 shrink-0 flex-col gap-1 overflow-auto border-l border-border-subtle p-1.5"
        data-testid="asset-build-settings"
      >
        <h3 class="truncate font-medium" translate="no">{{ selected.name }}</h3>
        <p v-if="selected.reason !== null" :class="MARK[selected.state]">{{ selected.reason }}</p>
        <label
          v-for="role in CODEC_ROLES"
          :key="role"
          class="flex items-center gap-1"
          :for="`asset-build-codec-${role}`"
        >
          <span class="w-28 shrink-0">{{ $t(`asset-build-codec-${role}`) }}</span>
          <select
            :id="`asset-build-codec-${role}`"
            v-model="texts.codecs[role]"
            :class="input"
            :data-testid="`asset-build-codec-${role}`"
          >
            <option value="">{{ $t("asset-build-project") }}</option>
            <option v-for="codec in CODECS[role]" :key="codec" :value="codec" translate="no">{{ codec }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1" for="asset-build-lods">
          <span class="w-28 shrink-0">{{ $t("asset-build-lods") }}</span>
          <input
            id="asset-build-lods"
            v-model="texts.lods"
            type="number"
            min="1"
            max="8"
            :class="[input, 'w-16']"
            :placeholder="$t('asset-build-project')"
            data-testid="asset-build-lods"
          />
        </label>
        <Button size="sm" class="self-start" data-testid="asset-build-save" @click="save">
          {{ $t("asset-build-save") }}
        </Button>
        <h4 v-if="selected.lods.length > 0" class="mt-1 font-medium">{{ $t("asset-build-levels") }}</h4>
        <ul class="flex flex-col gap-0.5">
          <li v-for="lod in selected.lods" :key="lod.tier" class="flex items-center gap-2" :data-tier="lod.tier">
            <span class="w-14" translate="no">{{ lod.tier }}</span>
            <span class="flex-1 text-text-secondary" translate="no">
              {{ lod.triangles === null ? "" : $t("asset-build-triangles", { count: lod.triangles }) }}
            </span>
            <Button size="sm" variant="ghost" :data-testid="`asset-build-preview-${lod.tier}`" @click="tier = lod.tier">
              {{ $t("asset-build-preview") }}
            </Button>
          </li>
        </ul>
        <LivePreview
          v-if="tier !== null && (selected.kind === 'model' || selected.kind === 'skinned-model')"
          :id="selected.id"
          :base="source.base"
          kind="turntable"
          :version="0"
          :tier="tier"
        />
      </aside>
    </div>
  </section>
</template>
