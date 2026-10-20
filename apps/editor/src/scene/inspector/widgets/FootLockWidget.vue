<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of the foot lock of an animator (`animator.footLock`): a row for each leg (the
 * upper bone, the lower bone, the end bone at the ankle and a bone that follows the end; the bone names of the model
 * are the choices), the contact share and the fade share. Add a leg takes the bones of a leg from the names of the
 * model; with no foot lock, Add the foot lock puts the first leg. Each change is one step of the history.
 */
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed, onMounted, shallowRef } from "vue";
import { useInspector, type FieldPath } from "../inspectorState";
import { button, field, fieldTestId } from "../inspectorUi";
import { footLockOf, guessLeg, LEG_PARTS, withLegPart, type FootLockValue, type LegPart } from "./footLock";

const props = defineProps<{ definition: ComponentDefinition; path: FieldPath; value: unknown; label: string }>();
const { $t } = useI18n();
const inspector = useInspector();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const lock = computed(() => footLockOf(props.value));
/** The bone names of the model of the entity (the inspect report of the core). */
const bones = shallowRef<readonly string[]>([]);
const list = computed(() => `${testId.value}-bones`);

onMounted(async () => {
  const entity = inspector.one();
  const report = (await globalThis.__scenity?.inspect?.()) as
    { entities?: readonly { id: string; parts?: { bones?: readonly string[] } }[] } | null | undefined;
  bones.value = report?.entities?.find((item) => item.id === entity)?.parts?.bones ?? [];
});

function write(next: FootLockValue | undefined): void {
  inspector.set(props.definition, props.path, next);
}

function addLeg(): void {
  const legs = lock.value?.legs ?? [];
  const leg = guessLeg(bones.value, legs);
  if (leg === null) return;
  write({ ...(lock.value ?? {}), legs: [...legs, leg] });
}

function setPart(index: number, part: LegPart, event: Event): void {
  if (lock.value === null) return;
  write(withLegPart(lock.value, index, part, (event.target as HTMLInputElement).value));
}

function removeLeg(index: number): void {
  if (lock.value === null) return;
  const legs = lock.value.legs.filter((_leg, at) => at !== index);
  write(legs.length === 0 ? undefined : { ...lock.value, legs });
}

function setShare(key: "contact" | "fade", event: Event): void {
  if (lock.value === null) return;
  const text = (event.target as HTMLInputElement).value.trim();
  write({ ...lock.value, [key]: text === "" ? undefined : Number(text) });
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId">
    <datalist :id="list">
      <option v-for="bone in bones" :key="bone" :value="bone" />
    </datalist>
    <template v-if="lock !== null">
      <div
        v-for="(leg, index) in lock.legs"
        :key="index"
        class="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-center gap-1"
        :data-testid="`${testId}-leg-${index}`"
      >
        <input
          v-for="part in LEG_PARTS"
          :key="part"
          :class="field"
          :value="leg[part] ?? ''"
          :list="list"
          :placeholder="$t(`inspector-foot-${part}`)"
          :aria-label="$t('inspector-foot-part', { part: $t(`inspector-foot-${part}`), leg: index + 1 })"
          :data-testid="`${testId}-leg-${index}-${part}`"
          translate="no"
          @change="setPart(index, part, $event)"
        />
        <button type="button" :class="button" :data-testid="`${testId}-leg-${index}-remove`" @click="removeLeg(index)">
          {{ $t("inspector-foot-remove-leg") }}
        </button>
      </div>
      <div class="flex items-center gap-1">
        <label :for="`${testId}-contact`" class="flex items-center gap-1" :title="$t('inspector-foot-contact-title')">
          {{ $t("inspector-foot-contact") }}
          <input
            :id="`${testId}-contact`"
            :class="[field, 'w-16']"
            type="number"
            min="0.01"
            max="1"
            step="0.05"
            :value="lock.contact ?? ''"
            placeholder="0.2"
            :data-testid="`${testId}-contact`"
            @change="setShare('contact', $event)"
          />
        </label>
        <label :for="`${testId}-fade`" class="flex items-center gap-1" :title="$t('inspector-foot-fade-title')">
          {{ $t("inspector-foot-fade") }}
          <input
            :id="`${testId}-fade`"
            :class="[field, 'w-16']"
            type="number"
            min="0"
            max="0.5"
            step="0.05"
            :value="lock.fade ?? ''"
            placeholder="0.15"
            :data-testid="`${testId}-fade`"
            @change="setShare('fade', $event)"
          />
        </label>
      </div>
    </template>
    <p v-else class="text-caption text-text-secondary">{{ $t("inspector-foot-none") }}</p>
    <div class="flex gap-1">
      <button
        type="button"
        :class="button"
        :disabled="guessLeg(bones, lock?.legs ?? []) === null"
        :data-testid="`${testId}-add`"
        @click="addLeg"
      >
        {{ lock === null ? $t("inspector-foot-add") : $t("inspector-foot-add-leg") }}
      </button>
      <button
        v-if="lock !== null"
        type="button"
        :class="button"
        :data-testid="`${testId}-remove`"
        @click="write(undefined)"
      >
        {{ $t("inspector-foot-remove") }}
      </button>
    </div>
  </div>
</template>
