<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The import again of the asset inspector: the settings form of the importer of the record,
 * with the settings of the record, and "Import again". The server writes the changed settings into the record and
 * imports the asset again. Then the inspector shows the new facts.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, onMounted, ref, shallowRef, useId, watch } from "vue";
import type { AssetSource } from "./assetClient";
import type { AssetDetails, ImporterForm } from "./assetTypes";
import { settingFields, settingsValue } from "./settingsForm";
import SettingsFields from "./SettingsFields.vue";

const props = defineProps<{ source: AssetSource; details: AssetDetails }>();
const emit = defineEmits<{ done: [details: AssetDetails] }>();
const { $t } = useI18n();
const id = useId();
const forms = shallowRef<readonly ImporterForm[]>([]);
onMounted(async () => (forms.value = (await props.source.importers?.()) ?? []));

const form = computed(() => forms.value.find((each) => each.name === props.details.record.importer));
const fields = computed(() => (form.value === undefined ? [] : settingFields(form.value.schema)));
/** The texts of the fields: the settings of the record. */
const texts = ref<Record<string, string>>({});
watch(
  () => props.details.record.settings,
  (settings) => {
    const entries = Object.entries(typeof settings === "object" && settings !== null ? settings : {});
    texts.value = Object.fromEntries(
      entries.map(([name, value]) => [name, typeof value === "string" ? value : JSON.stringify(value)]),
    );
  },
  { immediate: true },
);
const busy = ref(false);
const reason = ref<string | null>(null);

async function again(): Promise<void> {
  if (props.source.reimport === undefined) return;
  let settings: Record<string, unknown>;
  try {
    settings = settingsValue(fields.value, texts.value);
  } catch (error) {
    reason.value = $t("assets-import-setting-bad", { field: error instanceof Error ? error.message : String(error) });
    return;
  }
  busy.value = true;
  reason.value = null;
  const result = await props.source.reimport({ id: props.details.id, settings });
  busy.value = false;
  if (result.ok) emit("done", result.details);
  else reason.value = result.reason;
}
</script>

<template>
  <details class="flex flex-col gap-1" data-testid="asset-reimport">
    <summary class="cursor-pointer font-medium">{{ $t("asset-reimport") }}</summary>
    <SettingsFields
      :fields="fields"
      :texts="texts"
      :id-prefix="id"
      @set="(name, value) => (texts = { ...texts, [name]: value })"
    />
    <p v-if="reason !== null" class="text-status-critical" role="alert">{{ reason }}</p>
    <Button
      size="sm"
      variant="primary"
      class="self-start"
      :disabled="busy || source.reimport === undefined"
      data-testid="asset-reimport-start"
      @click="again"
    >
      {{ busy ? $t("assets-import-state-importing") : $t("asset-reimport-start") }}
    </Button>
  </details>
</template>
