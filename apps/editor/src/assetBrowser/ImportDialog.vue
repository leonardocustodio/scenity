<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The import dialog of the asset browser: the chosen or dropped files with the importer of each, the settings form of
 * each importer (SettingsFields.vue), the rights record of the import, and the folder. The rights record is a record
 * of the project, or the default `rights/imports.yaml`. Import gives the files with these options to the browser,
 * which imports them in sequence.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { computed, onMounted, ref, shallowRef, useId } from "vue";
import type { AssetSource } from "./assetClient";
import type { ImporterForm, ImportOptions, RightsSummary } from "./assetTypes";
import { formFor, settingFields, settingsValue, type SettingField } from "./settingsForm";
import RightsForm from "./RightsForm.vue";
import SettingsFields from "./SettingsFields.vue";

const props = defineProps<{
  files: readonly File[];
  source: AssetSource;
}>();
const emit = defineEmits<{ import: [files: readonly File[], options: ImportOptions]; cancel: [] }>();
const { $t } = useI18n();
const ids = { folder: useId(), field: useId() };

/** The choice of the default rights record (a select item needs a value that is not empty). */
const DEFAULT_RIGHTS = "*default";
const forms = shallowRef<readonly ImporterForm[]>([]);
const records = shallowRef<readonly RightsSummary[]>([]);
onMounted(async () => {
  [forms.value, records.value] = await Promise.all([
    props.source.importers?.() ?? Promise.resolve([]),
    props.source.rights?.() ?? Promise.resolve([]),
  ]);
});

/** The importers of the files (one form for each importer). */
const groups = computed(() => {
  const out = new Map<string, { form: ImporterForm; fields: SettingField[]; files: string[] }>();
  for (const file of props.files) {
    const form = formFor(forms.value, file.name);
    if (form === undefined) continue;
    const group = out.get(form.name) ?? { form, fields: settingFields(form.schema), files: [] };
    group.files.push(file.name);
    out.set(form.name, group);
  }
  return [...out.values()];
});
const texts = ref<Record<string, Record<string, string>>>({});
function setText(importer: string, name: string, value: string): void {
  texts.value = { ...texts.value, [importer]: { ...texts.value[importer], [name]: value } };
}

const rights = ref(DEFAULT_RIGHTS);
const rightsOptions = computed(() => [
  { value: DEFAULT_RIGHTS, label: $t("assets-import-rights-default") },
  ...records.value.map((record) => ({
    value: record.path,
    label: `${record.name} · ${record.spdx ?? record.licence}`,
  })),
]);
const folder = ref("");
/** The form of a new rights record (only with a source that writes rights records). */
const making = ref(false);
async function made(path: string): Promise<void> {
  making.value = false;
  records.value = (await props.source.rights?.()) ?? records.value;
  rights.value = path;
}
const problem = ref<string | null>(null);

function start(): void {
  // One import has one set of settings, so the dialog imports each importer group with its own settings.
  try {
    for (const group of groups.value) {
      const settings = settingsValue(group.fields, texts.value[group.form.name] ?? {});
      const options: ImportOptions = {
        ...(Object.keys(settings).length === 0 ? {} : { settings }),
        ...(rights.value === DEFAULT_RIGHTS ? {} : { rights: rights.value }),
        ...(folder.value.trim() === "" ? {} : { folder: folder.value.trim() }),
      };
      emit(
        "import",
        props.files.filter((file) => group.files.includes(file.name)),
        options,
      );
    }
  } catch (error) {
    problem.value = $t("assets-import-setting-bad", { field: error instanceof Error ? error.message : String(error) });
  }
}

const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex flex-col gap-2 border-b border-border-subtle bg-surface-overlay p-2 text-caption"
    :aria-label="$t('assets-import-dialog')"
    data-testid="asset-import-dialog"
  >
    <h3 class="font-semibold">{{ $t("assets-import-dialog-title", { count: files.length }) }}</h3>
    <ul class="flex flex-col gap-0.5">
      <li v-for="file in files" :key="file.name" class="flex gap-2" data-testid="asset-import-file">
        <span class="min-w-0 flex-1 truncate" translate="no">{{ file.name }}</span>
        <span class="text-text-secondary" translate="no">{{
          formFor(forms, file.name)?.name ?? $t("assets-import-no-importer")
        }}</span>
      </li>
    </ul>
    <section
      v-for="group in groups"
      :key="group.form.name"
      class="flex flex-col gap-1"
      :data-importer="group.form.name"
      data-testid="asset-import-settings"
    >
      <h4 class="font-semibold" translate="no">{{ group.form.name }}</h4>
      <SettingsFields
        :fields="group.fields"
        :texts="texts[group.form.name] ?? {}"
        :id-prefix="`${ids.field}-${group.form.name}`"
        @set="(name, value) => setText(group.form.name, name, value)"
      />
    </section>
    <div class="flex flex-wrap items-center gap-1">
      <span>{{ $t("assets-import-rights") }}</span>
      <Select
        v-model="rights"
        :options="rightsOptions"
        class="w-64"
        :aria-label="$t('assets-import-rights')"
        data-testid="import-rights"
      />
      <Button
        v-if="source.writeRights !== undefined"
        size="sm"
        variant="ghost"
        data-testid="import-new-rights"
        @click="making = !making"
      >
        {{ $t("assets-import-new-rights") }}
      </Button>
      <label class="flex items-center gap-1" :for="ids.folder">
        {{ $t("assets-import-folder") }}
        <input
          :id="ids.folder"
          v-model="folder"
          :class="[input, 'w-40']"
          :placeholder="$t('assets-import-folder-default')"
          data-testid="import-folder"
        />
      </label>
    </div>
    <RightsForm
      v-if="making && source.writeRights !== undefined"
      :write="source.writeRights"
      @saved="made"
      @cancel="making = false"
    />
    <p v-if="problem !== null" class="text-status-negative" role="alert">{{ problem }}</p>
    <div class="flex gap-1">
      <Button size="sm" variant="primary" data-testid="import-start" @click="start">{{
        $t("assets-import-start")
      }}</Button>
      <Button size="sm" variant="ghost" data-testid="import-cancel" @click="emit('cancel')">{{
        $t("assets-import-cancel")
      }}</Button>
    </div>
  </section>
</template>
