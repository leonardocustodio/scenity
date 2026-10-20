<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The asset inspector of the asset browser: the preview of the kind of the asset, the facts, the record fields, the
 * import again, and the "used by" lines. The facts are the size, the triangles, the meshes, the extent, the levels of
 * detail, the clips, the rig, the pixels of a texture and the length of a sound.
 * The facts and the record come from the details of the source (`assets.asset.json`). A source with no details shows
 * the facts of the list entry.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, ref, shallowRef, watch } from "vue";
import type { AssetSource } from "./assetClient";
import type { UseLine } from "./assetFilter";
import type { AssetDetails, AssetListEntry } from "./assetTypes";
import AssetPreview from "./preview/AssetPreview.vue";
import { factsOf, recordFields } from "./preview/previewKinds";
import ReimportForm from "./ReimportForm.vue";

const props = defineProps<{
  asset: AssetListEntry;
  source: AssetSource;
  /** False when the source serves no project files: the preview shows the icon of the kind. */
  stills: boolean;
  lines: readonly UseLine[];
  selectEntity?: ((id: string) => void) | undefined;
  openPrefab?: ((source: string) => void) | undefined;
  openMaterial?: ((ref: string) => void) | undefined;
  openDocument?: ((path: string) => void) | undefined;
}>();
const emit = defineEmits<{ changed: [] }>();
const { $t, $ta } = useI18n();

const details = shallowRef<AssetDetails | null>(null);
/** It changes after an import again, so the preview loads the asset again. */
const version = ref(0);
watch(
  () => props.asset.id,
  async (id) => {
    details.value = null;
    const found = (await props.source.details?.(id)) ?? null;
    if (props.asset.id === id) details.value = found;
  },
  { immediate: true },
);
const facts = computed(() => factsOf(props.asset, details.value));
const fields = computed(() => (details.value === null ? [] : recordFields(details.value.record)));
const warnings = computed(() => details.value?.imported?.warnings ?? []);

function reimported(fresh: AssetDetails): void {
  details.value = fresh;
  version.value += 1;
  emit("changed");
}
const chip = "h-6 px-1.5 text-caption";
</script>

<template>
  <aside
    class="flex w-64 shrink-0 flex-col gap-1 overflow-auto border-l border-border-subtle p-1.5 text-caption"
    :aria-label="$t('asset-inspector')"
    data-testid="asset-details"
  >
    <h3 class="truncate font-medium" translate="no">{{ asset.name }}</h3>
    <p class="truncate text-text-secondary" translate="no">{{ asset.kind }} · {{ asset.id }}</p>
    <AssetPreview :asset="asset" :base="stills ? source.base : null" :version="version" />
    <dl class="grid grid-cols-[auto_1fr] gap-x-2" data-testid="asset-facts">
      <template v-for="fact in facts" :key="fact.label">
        <dt class="text-text-secondary">{{ $t(fact.label) }}</dt>
        <dd class="truncate" translate="no" :title="fact.value" :data-fact="fact.label">{{ fact.value }}</dd>
      </template>
    </dl>
    <dl v-if="fields.length > 0" class="grid grid-cols-[auto_1fr] gap-x-2" data-testid="asset-record">
      <template v-for="field in fields" :key="field.label">
        <dt class="text-text-secondary">{{ $t(field.label) }}</dt>
        <dd class="truncate font-mono" translate="no" :title="field.value" :data-field="field.label">
          {{ field.value }}
        </dd>
      </template>
    </dl>
    <p v-for="warning in warnings" :key="warning" class="text-status-caution">{{ warning }}</p>
    <ReimportForm
      v-if="details !== null && source.reimport !== undefined"
      :source="source"
      :details="details"
      @done="reimported"
    />
    <div class="flex flex-wrap gap-1">
      <Button
        v-if="openPrefab !== undefined && asset.source.endsWith('.prefab.json')"
        size="sm"
        :class="chip"
        :title="$ta('assets-open-prefab').title"
        data-testid="asset-open-prefab"
        @click="openPrefab(asset.source)"
      >
        {{ $t("assets-open-prefab") }}
      </Button>
      <Button
        v-if="openMaterial !== undefined && asset.kind === 'material'"
        size="sm"
        :class="chip"
        :title="$ta('assets-edit-material').title"
        data-testid="asset-edit-material"
        @click="openMaterial(`asset:${asset.id}`)"
      >
        {{ $t("assets-edit-material") }}
      </Button>
    </div>
    <p v-for="problem in asset.problems" :key="problem" class="text-status-caution">{{ problem }}</p>
    <h4 class="mt-1.5 font-medium">{{ $t("assets-used-by") }}</h4>
    <ul data-testid="asset-used-by">
      <li v-if="lines.length === 0" class="text-text-secondary">{{ $t("assets-unused") }}</li>
      <li v-for="line in lines" :key="`${line.where}:${line.text}`" class="truncate" :data-where="line.where">
        <button
          v-if="line.entity !== undefined && selectEntity !== undefined"
          type="button"
          class="text-text-link hover:underline"
          translate="no"
          @click="selectEntity(line.entity)"
        >
          {{ line.text }}
        </button>
        <button
          v-else-if="line.document?.endsWith('.scene.json') === true && openDocument !== undefined"
          type="button"
          class="text-text-link hover:underline"
          translate="no"
          data-testid="asset-open-scene"
          @click="openDocument(line.document)"
        >
          {{ line.text }}
        </button>
        <span v-else :class="line.where === 'document' && 'text-text-secondary'" translate="no">{{ line.text }}</span>
      </li>
    </ul>
  </aside>
</template>
