<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One field row of the inspector: the label, the widget of the field, and its marks and actions. A mixed value
 * shows "—". An override of a prefab instance has a mark and a "revert" button (back to the prefab value). An
 * override also has a bold value and a bar in the margin, in the override colour of the studio. A stored
 * value that a default can replace has a "reset" button (back to the default of the component). A field with
 * a custom widget of an environment hint (fog, bloom, ambient occlusion, selection outline) has a live preview.
 * With an open sequence, a field that a track can drive has a key mark (no track, a track, a key at the time
 * of the clock); a press keys the value of the field at that time. A sound field (an `audio` asset) has a
 * preview: a press plays the sound once.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The field label comes from the schema: it
 * is data (`translate="no"`).
 */
import type { FieldModel } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { cn } from "@scenity/ui";
import { computed } from "vue";
import { useInspector, type FieldPath } from "./inspectorState";
import { fieldTestId, iconButton } from "./inspectorUi";
import ValueWidget from "./ValueWidget.vue";
import EnvironmentPreview from "./EnvironmentPreview.vue";
import { hasPreview } from "./environmentPreviews";
import { customWidget } from "./customWidgets";
import { pageReview } from "../review/reviewState";
import { pageSequenceKeys } from "../sequencer/sequenceKeys";
import { previewing, toggleSoundPreview } from "./soundPreview";
import { Check, X } from "lucide-vue-next";

const props = defineProps<{
  definition: ComponentDefinition;
  field: FieldModel;
  path: FieldPath;
  /** A field of a nested object: a smaller label. */
  nested?: boolean;
}>();

const inspector = useInspector();
const { $t } = useI18n();
const state = computed(() => inspector.state(props.definition, props.path));
const testId = computed(() => `${fieldTestId(props.definition.id, props.path)}-row`);
/** The custom widget of the hint of the field, or null (the widget of the schema). */
const custom = computed(() => customWidget(props.field.custom));
/** The widgets that need the whole width under their label. */
const wide = computed(
  () => custom.value !== null || ["object", "list", "map", "curve", "choice", "json"].includes(props.field.widget.kind),
);
// A change of an agent that waits for review: the label in the colour of its session, the values on hover.
const change = computed(
  () =>
    pageReview()?.fieldMark(inspector.selected.value, ["components", props.definition.id, ...props.path].join(".")) ??
    null,
);
/** The key mark of the field for the one selected entity, or null. */
const keyState = computed(() => {
  const keys = pageSequenceKeys();
  const entity = inspector.one();
  if (keys === null || entity === null || !keys.keyable(props.definition.id, props.path)) return null;
  return { keys, entity, mark: keys.mark(entity, props.definition.id, props.path) };
});
function keyField(): void {
  const now = keyState.value;
  if (now !== null) void now.keys.key(now.entity, props.definition.id, props.path, state.value.value);
}
/** The sound asset of a sound field with a value, or null. */
const sound = computed(() => {
  const widget = props.field.widget;
  const value = state.value.value;
  return widget.kind === "assetRef" && widget.assetKind === "audio" && typeof value === "string" ? value : null;
});
/** A reset removes the stored key: a field of an object with a stored value and a default (or no need of one). */
const canReset = computed(
  () =>
    props.path.length > 0 && state.value.stored && (!props.field.required || state.value.defaultValue !== undefined),
);
</script>

<template>
  <div
    :class="
      cn(
        'flex min-w-0 gap-1',
        wide ? 'flex-col' : 'items-center',
        state.overridden && '-ml-1.5 border-l-2 border-studio-override-bar pl-1 font-semibold',
      )
    "
    :data-testid="testId"
    :data-mixed="state.mixed ? '1' : undefined"
    :data-overridden="state.overridden ? '1' : undefined"
    :data-review="change === null ? undefined : '1'"
    :data-component="definition.id"
    :data-field="path.join('.')"
  >
    <div :class="cn('flex min-w-0 items-center gap-1', !wide && 'w-28 shrink-0')">
      <button
        v-if="keyState !== null"
        type="button"
        :class="cn(iconButton, 'size-4 shrink-0', keyState.mark !== 'none' && 'text-accent-brand')"
        :aria-label="$t(`inspector-key-${keyState.mark}`)"
        :title="$t(`inspector-key-${keyState.mark}`)"
        :data-mark="keyState.mark"
        :data-testid="`${testId}-key`"
        @click="keyField"
      >
        {{ keyState.mark === "key" ? "◆" : keyState.mark === "track" ? "◈" : "◇" }}
      </button>
      <span
        v-if="change !== null"
        class="size-1.5 shrink-0 rounded-full"
        :style="{ background: change.colour }"
        role="img"
        :title="$t('review-mark-field', { by: change.by, before: change.before, after: change.after })"
        :aria-label="$t('review-mark-field', { by: change.by, before: change.before, after: change.after })"
        :data-testid="`${testId}-review`"
      />
      <template v-if="change !== null">
        <button
          type="button"
          :class="iconButton"
          :aria-label="$t('review-accept-op')"
          :title="$t('review-accept-op')"
          :data-testid="`${testId}-accept`"
          @click="pageReview()?.acceptMark(change)"
        >
          <Check class="size-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="iconButton"
          :aria-label="$t('review-reject-op')"
          :title="$t('review-reject-op')"
          :data-testid="`${testId}-reject`"
          @click="pageReview()?.rejectMark(change)"
        >
          <X class="size-3" aria-hidden="true" />
        </button>
      </template>
      <button
        v-if="sound !== null"
        type="button"
        :class="iconButton"
        :aria-pressed="previewing === sound"
        :aria-label="$t(previewing === sound ? 'inspector-sound-stop' : 'inspector-sound-play')"
        :title="$t(previewing === sound ? 'inspector-sound-stop' : 'inspector-sound-play')"
        :data-playing="previewing === sound ? '1' : '0'"
        :data-testid="`${testId}-preview`"
        @click="toggleSoundPreview(sound)"
      >
        {{ previewing === sound ? "■" : "▶" }}
      </button>
      <span
        v-if="state.overridden"
        class="size-1.5 shrink-0 rounded-full bg-accent-brand"
        :title="$t('inspector-field-overridden-title')"
        :aria-label="$t('inspector-field-overridden')"
      />
      <span
        :class="cn('truncate text-caption', nested ? 'text-text-secondary' : 'text-text-primary')"
        :title="`${field.label} (${field.key})`"
        translate="no"
      >
        {{ field.label }}
      </span>
      <span v-if="state.mixed" class="text-caption text-text-secondary" :title="$t('inspector-field-mixed-title')">
        {{ $t("inspector-field-mixed") }}
      </span>
      <span v-if="wide" class="ml-auto flex items-center">
        <button
          v-if="state.overridden"
          type="button"
          :class="iconButton"
          :title="$t('inspector-field-revert')"
          :data-testid="`${testId}-revert`"
          @click="inspector.resetPrefab(definition, path)"
        >
          ⤺
        </button>
        <button
          v-if="canReset"
          type="button"
          :class="iconButton"
          :title="$t('inspector-field-reset')"
          :data-testid="`${testId}-reset`"
          @click="inspector.reset(definition, path)"
        >
          ↺
        </button>
      </span>
    </div>
    <!-- The live preview of an environment hint over its fields. -->
    <EnvironmentPreview
      v-if="hasPreview(field.custom)"
      :kind="field.custom"
      :definition="definition"
      :value="state.value"
    />
    <component
      :is="custom"
      v-if="custom !== null"
      :definition="definition"
      :path="path"
      :value="state.value"
      :label="field.label"
    />
    <ValueWidget
      v-else
      :definition="definition"
      :path="path"
      :widget="field.widget"
      :value="state.value"
      :values="state.values"
      :mixed="state.mixed"
      :label="field.label"
    />
    <template v-if="!wide">
      <button
        v-if="state.overridden"
        type="button"
        :class="iconButton"
        :title="$t('inspector-field-revert')"
        :data-testid="`${testId}-revert`"
        @click="inspector.resetPrefab(definition, path)"
      >
        ⤺
      </button>
      <button
        v-if="canReset"
        type="button"
        :class="iconButton"
        :title="$t('inspector-field-reset')"
        :data-testid="`${testId}-reset`"
        @click="inspector.reset(definition, path)"
      >
        ↺
      </button>
      <span v-if="!state.overridden && !canReset" class="size-6 shrink-0" aria-hidden="true" />
    </template>
  </div>
</template>
