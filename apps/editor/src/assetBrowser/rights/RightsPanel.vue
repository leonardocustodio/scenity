<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Rights panel: the licence policy of the project (`release.licences.allow`: the SPDX IDs that the release gate
 * accepts, with Add and Remove), and the rights records of the project with their problems. A record has a mark when
 * the policy does not accept its licence. The panel also has the form of a new record. The rights step of the
 * quickstart needs no text editor.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { onMounted, ref, shallowRef } from "vue";
import type { AssetSource } from "../assetClient";
import type { LicencePolicy, RightsSummary } from "../assetTypes";
import RightsForm from "../RightsForm.vue";
import { SPDX_CHOICES } from "./spdx";

const props = defineProps<{ source: AssetSource }>();
const { $t } = useI18n();
const policy = shallowRef<LicencePolicy | null>(null);
const records = shallowRef<readonly RightsSummary[]>([]);
const added = ref("");
const note = ref<string | null>(null);
const making = ref(false);

async function read(): Promise<void> {
  [policy.value, records.value] = await Promise.all([props.source.licences?.() ?? null, props.source.rights?.() ?? []]);
}
onMounted(() => void read());

async function writeAllow(allow: readonly string[]): Promise<void> {
  const result = await props.source.writeLicences?.(allow);
  note.value = result === undefined || result.ok ? null : result.reason;
  await read();
}
async function add(): Promise<void> {
  const id = added.value.trim();
  if (id === "" || policy.value === null) return;
  added.value = "";
  await writeAllow([...policy.value.allow, id]);
}
const accepted = (record: RightsSummary): boolean =>
  record.spdx !== null && (policy.value?.allow.includes(record.spdx) ?? false);
async function made(): Promise<void> {
  making.value = false;
  await read();
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('rights-panel')"
    data-testid="rights-panel"
  >
    <h3 class="font-medium">{{ $t("rights-policy") }}</h3>
    <p class="text-text-secondary">{{ $t("rights-policy-hint") }}</p>
    <ul class="flex flex-wrap gap-1" data-testid="rights-policy">
      <li
        v-for="id in policy?.allow ?? []"
        :key="id"
        class="flex items-center gap-1 rounded-pill border border-border-subtle px-1.5"
        :data-spdx="id"
      >
        <span translate="no">{{ id }}</span>
        <button
          type="button"
          class="text-text-secondary hover:text-text-primary"
          :aria-label="$t('rights-policy-remove', { id })"
          :data-testid="`rights-policy-remove-${id}`"
          @click="writeAllow((policy?.allow ?? []).filter((each) => each !== id))"
        >
          ×
        </button>
      </li>
      <li v-if="(policy?.allow.length ?? 0) === 0" class="text-status-caution">{{ $t("rights-policy-none") }}</li>
    </ul>
    <form class="flex items-center gap-1" @submit.prevent="add">
      <label class="flex items-center gap-1" for="rights-policy-add">
        {{ $t("rights-policy-add") }}
        <input
          id="rights-policy-add"
          v-model="added"
          list="rights-policy-spdx"
          class="h-7 w-36 rounded-control border border-border-subtle bg-surface-sunken px-1.5 font-mono text-text-primary"
          data-testid="rights-policy-input"
        />
      </label>
      <datalist id="rights-policy-spdx">
        <option v-for="[key, title] in SPDX_CHOICES" :key="key" :value="key">{{ title }}</option>
      </datalist>
      <Button size="sm" type="submit" data-testid="rights-policy-add">{{ $t("rights-policy-add-button") }}</Button>
    </form>
    <p v-if="note !== null" class="text-status-negative" role="alert">{{ note }}</p>
    <h3 class="font-medium">{{ $t("rights-records") }}</h3>
    <ul class="flex flex-col gap-0.5" data-testid="rights-records">
      <li
        v-for="record in records"
        :key="record.path"
        class="flex flex-col"
        :data-record="record.name"
        :data-accepted="accepted(record) ? '1' : '0'"
      >
        <span class="flex gap-2">
          <span class="font-mono" translate="no">{{ record.name }}</span>
          <span class="text-text-secondary" translate="no">{{ record.spdx ?? record.licence }}</span>
          <span v-if="!accepted(record)" class="text-status-caution">{{ $t("rights-not-accepted") }}</span>
        </span>
        <span v-for="problem in record.problems ?? []" :key="problem" class="text-status-caution">{{ problem }}</span>
      </li>
    </ul>
    <Button
      v-if="source.writeRights !== undefined && !making"
      size="sm"
      class="self-start"
      data-testid="rights-new"
      @click="making = true"
    >
      {{ $t("assets-import-new-rights") }}
    </Button>
    <RightsForm
      v-if="making && source.writeRights !== undefined"
      :write="source.writeRights"
      @saved="made"
      @cancel="making = false"
    />
  </section>
</template>
