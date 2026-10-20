<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The raw JSON mode of the inspector: the name, the tags and the components of the one entity
 * as JSON in a field. Apply makes the ops of the change (one step of the history); a text that does not read or a
 * value that its schema refuses says why and changes nothing. The JSON is data (`translate="no"`).
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref, watch } from "vue";
import { entityJson } from "./entityEdits";
import { useInspector } from "./inspectorState";
import { button } from "./inspectorUi";

const inspector = useInspector();
const { $t } = useI18n();
const entity = computed(() => {
  const id = inspector.one();
  return id === null ? undefined : inspector.doc.value.entities[id];
});
const text = ref("");
const reason = ref<string | null>(null);
watch(
  entity,
  (next) => {
    text.value = next === undefined ? "" : entityJson(next);
    reason.value = null;
  },
  { immediate: true },
);

function apply(): void {
  reason.value = inspector.applyJson(text.value);
}
</script>

<template>
  <section class="flex flex-col gap-1" :aria-label="$t('inspector-json')" data-testid="inspector-json">
    <p v-if="entity === undefined" class="text-text-secondary">{{ $t("inspector-json-one") }}</p>
    <template v-else>
      <textarea
        v-model="text"
        rows="16"
        spellcheck="false"
        class="w-full resize-y rounded-control border border-border-subtle bg-surface-sunken p-1.5 font-mono text-caption"
        translate="no"
        :aria-label="$t('inspector-json')"
        data-testid="inspector-json-text"
      />
      <div class="flex items-center gap-2">
        <button type="button" :class="button" data-testid="inspector-json-apply" @click="apply">
          {{ $t("inspector-json-apply") }}
        </button>
        <span v-if="reason !== null" class="text-status-negative" role="alert" data-testid="inspector-json-error">
          {{ reason }}
        </span>
      </div>
    </template>
  </section>
</template>
