<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of the IK goals of a character (`character.ik`): for each goal (the left hand,
 * the right hand and the look of the head) its target (an entity or a socket), its weight from 0 to 1 and, for the
 * look, the most angle of the turn of the head in degrees. Remove removes a goal. The Character window moves the
 * targets with handles in the Scene view. Each change is one step of the history.
 */
import { CHARACTER_IK_GOALS } from "@scenity/scene/components";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "../inspectorState";
import { button, field, fieldTestId } from "../inspectorUi";
import RefWidget from "../RefWidget.vue";

type Goal = (typeof CHARACTER_IK_GOALS)[number];
interface GoalValue {
  readonly target?: string | null;
  readonly weight?: number;
  readonly maxAngle?: number;
  readonly pole?: readonly number[];
}

/** The message of the name of each goal. */
const GOAL_TEXT: Readonly<Record<Goal, string>> = {
  leftHand: "inspector-ik-left-hand",
  rightHand: "inspector-ik-right-hand",
  look: "inspector-ik-look",
};

const props = defineProps<{ definition: ComponentDefinition; path: FieldPath; value: unknown; label: string }>();
const { $t } = useI18n();
const inspector = useInspector();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const goals = computed(
  () =>
    (typeof props.value === "object" && props.value !== null ? props.value : {}) as Partial<Record<Goal, GoalValue>>,
);

/** Write one goal (undefined: remove it); the field goes when no goal stays. */
function setGoal(goal: Goal, value: GoalValue | undefined): void {
  const next = Object.fromEntries(
    CHARACTER_IK_GOALS.flatMap((key) => {
      const kept = key === goal ? value : goals.value[key];
      return kept === undefined ? [] : [[key, kept]];
    }),
  );
  inspector.set(props.definition, props.path, Object.keys(next).length === 0 ? undefined : next);
}

function setNumber(goal: Goal, key: "weight" | "maxAngle", event: Event): void {
  const text = (event.target as HTMLInputElement).value.trim();
  const number = key === "maxAngle" ? (Number(text) * Math.PI) / 180 : Number(text);
  setGoal(goal, { ...goals.value[goal], [key]: text === "" ? undefined : number });
}

const degrees = (radians: number | undefined): string =>
  radians === undefined ? "" : String(Math.round((radians * 180) / Math.PI));
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1.5" :data-testid="testId">
    <div v-for="goal in CHARACTER_IK_GOALS" :key="goal" class="flex flex-col gap-1" :data-testid="`${testId}-${goal}`">
      <span class="text-text-secondary">{{ $t(GOAL_TEXT[goal]) }}</span>
      <RefWidget
        :widget="{ kind: 'entityRef' }"
        :value="goals[goal]?.target ?? undefined"
        :mixed="false"
        :label="$t('inspector-ik-target', { goal: $t(GOAL_TEXT[goal]) })"
        :test-id="`${testId}-${goal}-target`"
        @change="setGoal(goal, { ...goals[goal], target: $event })"
      />
      <div v-if="goals[goal] !== undefined" class="flex items-center gap-1">
        <label :for="`${testId}-${goal}-weight`" class="flex items-center gap-1">
          {{ $t("inspector-ik-weight") }}
          <input
            :id="`${testId}-${goal}-weight`"
            :class="[field, 'w-16']"
            type="number"
            min="0"
            max="1"
            step="0.05"
            :value="goals[goal]?.weight ?? ''"
            placeholder="1"
            :data-testid="`${testId}-${goal}-weight`"
            @change="setNumber(goal, 'weight', $event)"
          />
        </label>
        <label v-if="goal === 'look'" :for="`${testId}-${goal}-angle`" class="flex items-center gap-1">
          {{ $t("inspector-ik-angle") }}
          <input
            :id="`${testId}-${goal}-angle`"
            :class="[field, 'w-16']"
            type="number"
            min="0"
            max="180"
            step="5"
            :value="degrees(goals[goal]?.maxAngle)"
            :data-testid="`${testId}-${goal}-angle`"
            @change="setNumber(goal, 'maxAngle', $event)"
          />
        </label>
        <button
          type="button"
          :class="button"
          :data-testid="`${testId}-${goal}-remove`"
          @click="setGoal(goal, undefined)"
        >
          {{ $t("inspector-ik-remove") }}
        </button>
      </div>
    </div>
  </div>
</template>
