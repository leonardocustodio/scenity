<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The asset sources of the asset browser: a provider (Poly Haven is built in), a kind (skies,
 * models, textures), a search, the previews of the items and Import. The import downloads the files of the item and
 * gives it the rights record of the provider, so a sky imports in 3 clicks (Get assets, the sky, Import).
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select, Toggle } from "@scenity/ui";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { AssetSource } from "../assetClient";
import type {
  AssetImportResult,
  GeneratorInfo,
  SourceItemInfo,
  SourceKindName,
  SourceProviderInfo,
} from "../assetTypes";
import GenerateForm from "./GenerateForm.vue";

const props = defineProps<{ source: AssetSource }>();
const emit = defineEmits<{ imported: [result: Extract<AssetImportResult, { ok: true }>]; close: [] }>();
const { $t } = useI18n();
const providers = shallowRef<readonly SourceProviderInfo[]>([]);
const provider = ref("");
const kind = ref<SourceKindName>("environment");
const text = ref("");
const items = shallowRef<readonly SourceItemInfo[] | null>(null);
const picked = ref<string | null>(null);
const busy = ref(false);
const reason = ref<string | null>(null);

/** The generators of the server, and the Generate view (a toggle of the dialog). */
const generators = shallowRef<readonly GeneratorInfo[]>([]);
const generating = ref(false);
onMounted(async () => {
  [providers.value, generators.value] = await Promise.all([
    props.source.sourceProviders?.() ?? null,
    props.source.generators?.() ?? null,
  ]).then(([found, made]) => [found ?? [], made ?? []] as const);
  provider.value = providers.value[0]?.id ?? "";
});
const kinds = computed(() => providers.value.find((each) => each.id === provider.value)?.kinds ?? []);
const options = computed(() => providers.value.map((each) => ({ value: each.id, label: each.name })));

let searchRun = 0;
async function search(): Promise<void> {
  if (provider.value === "" || props.source.searchSource === undefined) return;
  const mine = (searchRun += 1);
  items.value = null;
  picked.value = null;
  const found = await props.source.searchSource(provider.value, kind.value, text.value);
  if (mine !== searchRun) return;
  items.value = found ?? [];
  reason.value = found === null ? $t("sources-no-answer") : null;
}
watch([provider, kind], () => void search());

async function importPicked(): Promise<void> {
  const item = items.value?.find((each) => each.id === picked.value);
  if (item === undefined || props.source.importSource === undefined) return;
  busy.value = true;
  const result = await props.source.importSource({ provider: provider.value, id: item.id, kind: item.kind });
  busy.value = false;
  if (result.ok) emit("imported", result);
  else reason.value = result.reason;
}
</script>

<template>
  <section
    class="flex max-h-96 flex-col gap-1.5 border-b border-border-subtle bg-surface-overlay p-2 text-caption"
    :aria-label="$t('sources')"
    data-testid="asset-sources"
  >
    <div class="flex flex-wrap items-center gap-1">
      <Select
        v-if="options.length > 0"
        v-model="provider"
        :options="options"
        class="w-36"
        :aria-label="$t('sources-provider')"
        data-testid="sources-provider"
      />
      <div class="flex gap-0.5" role="group" :aria-label="$t('sources-kinds')">
        <Toggle
          v-for="each in kinds"
          :key="each"
          size="sm"
          class="h-6 px-1.5 text-caption"
          :model-value="kind === each"
          :data-testid="`sources-kind-${each}`"
          @update:model-value="kind = each"
          >{{ $t(`sources-kind-${each}`) }}</Toggle
        >
      </div>
      <form class="flex items-center gap-1" @submit.prevent="search">
        <input
          v-model="text"
          type="search"
          :placeholder="$t('sources-search')"
          :aria-label="$t('sources-search')"
          class="h-6 w-44 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-text-primary"
          data-testid="sources-search"
        />
      </form>
      <Toggle
        v-if="generators.length > 0"
        v-model="generating"
        size="sm"
        class="h-6 px-1.5 text-caption"
        data-testid="sources-generate"
        >{{ $t("generate") }}</Toggle
      >
      <span class="ml-auto text-text-secondary">{{ $t("sources-licence-note") }}</span>
      <Button size="sm" variant="ghost" data-testid="sources-close" @click="emit('close')">
        {{ $t("assets-import-cancel") }}
      </Button>
    </div>
    <GenerateForm
      v-if="generating"
      :source="source"
      :generators="generators"
      @imported="(result) => emit('imported', result)"
    />
    <template v-else>
      <p v-if="items === null && reason === null" class="text-text-secondary">{{ $t("sources-loading") }}</p>
      <p v-if="items !== null && items.length === 0" class="text-text-secondary">{{ $t("sources-none") }}</p>
      <div class="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1 overflow-auto">
        <button
          v-for="item in items ?? []"
          :key="item.id"
          type="button"
          class="flex min-w-0 flex-col gap-1 rounded-control p-1 text-left hover:bg-surface-raised"
          :class="picked === item.id && 'bg-accent-brand/15 ring-1 ring-accent-brand'"
          :aria-pressed="picked === item.id"
          :title="[item.name, item.licence, ...item.authors].join(' · ')"
          :data-testid="`sources-item-${item.id}`"
          @click="picked = item.id"
          @dblclick="importPicked"
        >
          <img
            v-if="source.sourcePreview !== undefined"
            :src="source.sourcePreview(provider, item.id)"
            alt=""
            loading="lazy"
            class="aspect-square w-full rounded-[0.3rem] bg-surface-sunken object-cover"
          />
          <span class="min-w-0 truncate" translate="no">{{ item.name }}</span>
        </button>
      </div>
      <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
      <Button
        size="sm"
        variant="primary"
        class="self-start"
        :disabled="picked === null || busy"
        data-testid="sources-import"
        @click="importPicked"
      >
        {{ busy ? $t("assets-import-state-importing") : $t("sources-import") }}
      </Button>
    </template>
  </section>
</template>
