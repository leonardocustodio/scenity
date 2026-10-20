<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The new plugin wizard of the Plugins window: the plugin ID, a component with its fields, and the parts to make (a
 * system, a presenter, a simulation, a metric of the rules, a studio panel). Make writes a folder plugin into the
 * project (`plugins/<id>/`) and lists it. Then the files open from the list, and "Ask the agent to write it" puts a
 * prompt for the logic in the agent panel (in the studio).
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { button, field as fieldClass, selectField } from "../inspector/inspectorUi";
import { pageKeys } from "../settings/pageKeys";

type Kind = "number" | "boolean" | "text";
type Part = "system" | "presenter" | "simulation" | "metric" | "studio";

const props = defineProps<{ base: string }>();
const emit = defineEmits<{ made: [] }>();
const { $t } = useI18n();
const id = ref("");
const component = ref("");
const fields = ref<{ name: string; kind: Kind }[]>([{ name: "speed", kind: "number" }]);
const parts = ref<Part[]>(["system"]);
const files = ref<string[]>([]);
const error = ref<string | null>(null);
const PARTS: readonly Part[] = ["system", "presenter", "simulation", "metric", "studio"];
const KINDS: readonly Kind[] = ["number", "boolean", "text"];
const agent = computed(() =>
  pageKeys()
    .commands()
    .some((command) => command.id === "agent.ask"),
);

async function make(): Promise<void> {
  const answer = await fetch(`${props.base}plugins.new`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({
      id: id.value.trim(),
      component: component.value.trim(),
      fields: fields.value,
      parts: parts.value,
    }),
  });
  const data = (await answer.json()) as { ok: boolean; files?: string[]; reason?: string };
  error.value = data.ok ? null : (data.reason ?? null);
  files.value = data.files ?? [];
  if (data.ok) emit("made");
}

function ask(): void {
  const names = fields.value.map((item) => `${item.name} (${item.kind})`).join(", ");
  const prompt = $t("plugins-new-prompt", { id: id.value, component: `${id.value}.${component.value}`, fields: names });
  void pageKeys().execute("agent.ask", { prompt });
}
</script>

<template>
  <form class="flex flex-col gap-1" :aria-label="$t('plugins-new')" data-testid="plugins-new" @submit.prevent="make">
    <h3 class="mt-1 font-semibold">{{ $t("plugins-new") }}</h3>
    <div class="flex flex-wrap items-center gap-1">
      <input
        v-model="id"
        :class="fieldClass"
        class="max-w-40"
        :placeholder="$t('plugins-new-id')"
        :aria-label="$t('plugins-new-id')"
        data-testid="plugins-new-id"
      />
      <input
        v-model="component"
        :class="fieldClass"
        class="max-w-40"
        :placeholder="$t('plugins-new-component')"
        :aria-label="$t('plugins-new-component')"
        data-testid="plugins-new-component"
      />
    </div>
    <div v-for="(item, index) in fields" :key="index" class="flex items-center gap-1" :data-field="index">
      <input
        v-model="item.name"
        :class="fieldClass"
        class="max-w-40"
        :aria-label="$t('plugins-new-field')"
        :data-testid="`plugins-new-field-${index}`"
      />
      <select
        v-model="item.kind"
        :class="selectField"
        class="max-w-28"
        :aria-label="$t('plugins-new-kind')"
        :data-testid="`plugins-new-kind-${index}`"
      >
        <option v-for="kind in KINDS" :key="kind" :value="kind">{{ $t(`plugins-new-kind-${kind}`) }}</option>
      </select>
      <button type="button" :class="button" @click="fields.splice(index, 1)">{{ $t("plugins-remove") }}</button>
    </div>
    <button
      type="button"
      :class="button"
      class="self-start"
      data-testid="plugins-new-add-field"
      @click="fields.push({ name: '', kind: 'number' })"
    >
      {{ $t("plugins-new-add-field") }}
    </button>
    <div class="flex flex-wrap items-center gap-2">
      <label v-for="part in PARTS" :key="part" class="flex items-center gap-1" :for="`plugins-new-part-${part}`">
        <input
          :id="`plugins-new-part-${part}`"
          v-model="parts"
          type="checkbox"
          :value="part"
          :data-testid="`plugins-new-part-${part}`"
        />
        {{ $t(`plugins-new-part-${part}`) }}
      </label>
    </div>
    <button
      type="submit"
      :class="button"
      class="self-start"
      :disabled="id.trim() === '' || component.trim() === ''"
      data-testid="plugins-new-make"
    >
      {{ $t("plugins-new-make") }}
    </button>
    <p v-if="error !== null" class="text-status-negative" role="alert" data-testid="plugins-new-error">{{ error }}</p>
    <template v-if="files.length > 0">
      <ul data-testid="plugins-new-files">
        <li v-for="file in files" :key="file">
          <a :href="`${base}${file}`" target="_blank" rel="noopener" class="underline" translate="no">{{ file }}</a>
        </li>
      </ul>
      <button v-if="agent" type="button" :class="button" class="self-start" data-testid="plugins-new-ask" @click="ask">
        {{ $t("plugins-new-ask") }}
      </button>
    </template>
  </form>
</template>
