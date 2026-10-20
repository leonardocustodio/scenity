<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The form of a new rights record: the name, the source and the author, the licence
 * with an SPDX picker (a choice fills the licence name), the licence date, the allowed uses and the web delivery.
 * Save writes `rights/<name>.yaml` through the source of the browser. The answer has the problems that the release
 * gate will see, and the form shows them.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ref, useId } from "vue";
import type { RightsInput, RightsWriteResult } from "./assetTypes";
import { SPDX_CHOICES } from "./rights/spdx";

const props = defineProps<{ write(input: RightsInput): Promise<RightsWriteResult> }>();
const emit = defineEmits<{ saved: [path: string]; cancel: [] }>();
const { $t } = useI18n();
const id = useId();

/** The SPDX IDs that the picker shows first, with their names. */
const SPDX = SPDX_CHOICES;
const USES = ["web", "public", "commercial", "unreal"] as const;

const name = ref("");
const source = ref("");
const author = ref("");
const spdx = ref("CC0-1.0");
const licence = ref(SPDX[0]?.[1] ?? "");
const date = ref(new Date().toISOString().slice(0, 10));
const uses = ref<string[]>(["web"]);
const delivery = ref<"true" | "pending" | "false">("true");
const problems = ref<readonly string[]>([]);
const reason = ref<string | null>(null);

function pickSpdx(value: string): void {
  spdx.value = value;
  const found = SPDX.find(([key]) => key === value);
  if (found !== undefined) licence.value = found[1];
}

async function save(): Promise<void> {
  const result = await props.write({
    name: name.value.trim(),
    source: source.value.trim(),
    author: author.value.trim(),
    licence: licence.value.trim(),
    spdx: spdx.value.trim() === "" ? null : spdx.value.trim(),
    licenceDate: date.value,
    allowedUse: uses.value,
    webDelivery: delivery.value === "pending" ? "pending" : delivery.value === "true",
  });
  if (!result.ok) {
    reason.value = result.reason;
    return;
  }
  reason.value = null;
  problems.value = result.problems;
  emit("saved", result.path);
}

const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <form
    class="flex flex-col gap-1 rounded-control border border-border-strong p-2"
    data-testid="rights-form"
    @submit.prevent="save"
  >
    <label class="flex items-center gap-1" :for="`${id}-name`">
      <span class="w-24 shrink-0">{{ $t("rights-name") }}</span>
      <input
        :id="`${id}-name`"
        v-model="name"
        :class="[input, 'w-40 font-mono']"
        :placeholder="$t('rights-name-sample')"
        data-testid="rights-name"
      />
    </label>
    <label class="flex items-center gap-1" :for="`${id}-source`">
      <span class="w-24 shrink-0">{{ $t("rights-source") }}</span>
      <input :id="`${id}-source`" v-model="source" :class="[input, 'w-64']" data-testid="rights-source" />
    </label>
    <label class="flex items-center gap-1" :for="`${id}-author`">
      <span class="w-24 shrink-0">{{ $t("rights-author") }}</span>
      <input :id="`${id}-author`" v-model="author" :class="[input, 'w-64']" data-testid="rights-author" />
    </label>
    <label class="flex items-center gap-1" :for="`${id}-spdx`">
      <span class="w-24 shrink-0">{{ $t("rights-spdx") }}</span>
      <input
        :id="`${id}-spdx`"
        :value="spdx"
        :class="[input, 'w-32 font-mono']"
        list="rights-spdx"
        data-testid="rights-spdx"
        @change="pickSpdx(($event.target as HTMLInputElement).value)"
      />
      <datalist id="rights-spdx">
        <option v-for="[key, title] in SPDX" :key="key" :value="key">{{ title }}</option>
      </datalist>
    </label>
    <label class="flex items-center gap-1" :for="`${id}-licence`">
      <span class="w-24 shrink-0">{{ $t("rights-licence") }}</span>
      <input :id="`${id}-licence`" v-model="licence" :class="[input, 'w-64']" data-testid="rights-licence" />
    </label>
    <label class="flex items-center gap-1" :for="`${id}-date`">
      <span class="w-24 shrink-0">{{ $t("rights-date") }}</span>
      <input :id="`${id}-date`" v-model="date" type="date" :class="input" data-testid="rights-date" />
    </label>
    <fieldset class="flex items-center gap-2">
      <legend class="sr-only">{{ $t("rights-uses") }}</legend>
      <span class="w-24 shrink-0">{{ $t("rights-uses") }}</span>
      <label v-for="use in USES" :key="use" class="flex items-center gap-1" :for="`${id}-use-${use}`">
        <input
          :id="`${id}-use-${use}`"
          v-model="uses"
          type="checkbox"
          :value="use"
          :data-testid="`rights-use-${use}`"
        />
        <span translate="no">{{ use }}</span>
      </label>
    </fieldset>
    <label class="flex items-center gap-1" :for="`${id}-delivery`">
      <span class="w-24 shrink-0">{{ $t("rights-delivery") }}</span>
      <select :id="`${id}-delivery`" v-model="delivery" :class="input" data-testid="rights-delivery">
        <option value="true">{{ $t("rights-delivery-yes") }}</option>
        <option value="pending">{{ $t("rights-delivery-pending") }}</option>
        <option value="false">{{ $t("rights-delivery-no") }}</option>
      </select>
    </label>
    <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
    <ul v-if="problems.length > 0" class="text-status-caution" data-testid="rights-problems">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>
    <div class="flex gap-1">
      <Button size="sm" variant="primary" type="submit" data-testid="rights-save">{{ $t("rights-save") }}</Button>
      <Button size="sm" variant="ghost" data-testid="rights-cancel" @click="emit('cancel')">{{
        $t("assets-import-cancel")
      }}</Button>
    </div>
  </form>
</template>
