<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of the clip source of an animator (`animator.clipSource`): the model asset whose
 * clips the animator plays (retargeted onto the model of the entity), and the rig profile of its skeleton (Auto: the
 * profile from its bone names). With no source, the animator plays the clips of its own model, and Remove returns to
 * them.
 */
import { NO_RIG_PROFILE, RIG_PROFILES } from "@scenity/character/profiles";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "../inspectorState";
import { button, fieldTestId, selectField } from "../inspectorUi";
import RefWidget from "../RefWidget.vue";

const props = defineProps<{ definition: ComponentDefinition; path: FieldPath; value: unknown; label: string }>();
const { $t } = useI18n();
const inspector = useInspector();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const source = computed(() =>
  typeof props.value === "object" && props.value !== null ? (props.value as { asset?: string; rig?: string }) : null,
);
/** The rig choices: Auto (no value), the profiles, and no profile. */
const rigs = computed(() => [
  { value: "", label: $t("inspector-clip-rig-auto") },
  ...RIG_PROFILES.map((profile) => ({ value: profile.id, label: profile.name })),
  { value: NO_RIG_PROFILE, label: $t("inspector-clip-rig-none") },
]);

function setAsset(asset: string): void {
  if (source.value === null) inspector.set(props.definition, props.path, { asset });
  else inspector.set(props.definition, [...props.path, "asset"], asset);
}
function setRig(event: Event): void {
  const rig = (event.target as HTMLSelectElement).value;
  inspector.set(props.definition, [...props.path, "rig"], rig === "" ? undefined : rig);
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId">
    <RefWidget
      :widget="{ kind: 'assetRef', assetKind: 'model' }"
      :value="source?.asset"
      :mixed="false"
      :label="$t('inspector-clip-asset')"
      :test-id="`${testId}-asset`"
      @change="setAsset"
    />
    <template v-if="source !== null">
      <select
        :class="selectField"
        :value="source.rig ?? ''"
        :aria-label="$t('inspector-clip-rig')"
        :data-testid="`${testId}-rig`"
        @change="setRig"
      >
        <option v-for="rig in rigs" :key="rig.value" :value="rig.value">{{ rig.label }}</option>
      </select>
      <button
        type="button"
        :class="[button, 'self-start']"
        :data-testid="`${testId}-remove`"
        @click="inspector.set(definition, path, undefined)"
      >
        {{ $t("inspector-clip-remove") }}
      </button>
    </template>
    <p v-else class="text-caption text-text-secondary">{{ $t("inspector-clip-none") }}</p>
  </div>
</template>
