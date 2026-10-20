<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * NumberField (Reka UI): a number input with decrement and increment buttons. Give the locale of the
 * value: a measured value uses the content locale of the session. The input takes `id` for Label.
 */
import { useI18n } from "@scenity/i18n";
import { Minus, Plus } from "lucide-vue-next";
import { computed } from "vue";
import { NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput, NumberFieldRoot } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { buttonVariants, fieldVariants } from "./variants";

defineOptions({ inheritAttrs: false });
const value = defineModel<number | null>({ default: null });
const props = withDefaults(
  defineProps<{
    min?: number | undefined;
    max?: number | undefined;
    step?: number;
    locale?: string;
    disabled?: boolean;
    invalid?: boolean;
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, max: undefined, min: undefined, step: 1, locale: "en-US", disabled: false, invalid: false },
);
const { $t } = useI18n();
const bounds = computed(() => ({
  ...(props.min === undefined ? {} : { min: props.min }),
  ...(props.max === undefined ? {} : { max: props.max }),
}));
</script>

<template>
  <NumberFieldRoot
    v-model="value"
    v-bind="bounds"
    :step="props.step"
    :locale="props.locale"
    :disabled="props.disabled"
    :class="cn('flex items-center gap-1', props.class)"
  >
    <NumberFieldDecrement
      :aria-label="$t('ui-number-decrement')"
      :class="buttonVariants({ variant: 'secondary', size: 'icon' })"
    >
      <Minus class="size-icon-sm" aria-hidden="true" />
    </NumberFieldDecrement>
    <NumberFieldInput
      v-bind="$attrs"
      :aria-invalid="props.invalid || undefined"
      :class="cn(fieldVariants(), 'sc-numeric w-24 text-center')"
    />
    <NumberFieldIncrement
      :aria-label="$t('ui-number-increment')"
      :class="buttonVariants({ variant: 'secondary', size: 'icon' })"
    >
      <Plus class="size-icon-sm" aria-hidden="true" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>
