<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Combobox (Reka UI): type to filter a list, then select one value.
 * The input has a visible label through `id` and Label, or an `aria-label`. The list keeps the given order:
 * the component does not sort the options.
 */
import { useI18n } from "@scenity/i18n";
import { Check, ChevronsUpDown } from "lucide-vue-next";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { usePortalTarget } from "../lib/portal";
import type { ListOption } from "./options";
import { fieldVariants, itemClass, panelClass } from "./variants";

defineOptions({ name: "ScCombobox", inheritAttrs: false });
const value = defineModel<string>({ default: "" });
const open = defineModel<boolean>("open", { default: false });
const props = withDefaults(
  defineProps<{
    options: readonly ListOption[];
    placeholder?: string | undefined;
    disabled?: boolean;
    invalid?: boolean;
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, placeholder: undefined, disabled: false, invalid: false },
);
const { $t } = useI18n();
const portal = usePortalTarget();

function labelOf(v: unknown): string {
  return props.options.find((o) => o.value === v)?.label ?? "";
}
</script>

<template>
  <ComboboxRoot v-model="value" v-model:open="open" :disabled="props.disabled">
    <ComboboxAnchor :class="cn(fieldVariants(), 'sc-field-focus pr-1', props.class)">
      <ComboboxInput
        v-bind="$attrs"
        :display-value="labelOf"
        :placeholder="props.placeholder ?? $t('ui-combobox-placeholder')"
        :aria-invalid="props.invalid || undefined"
        class="min-w-0 flex-1 self-stretch bg-transparent text-body outline-none"
      />
      <ComboboxTrigger
        :aria-label="$t('ui-combobox-toggle')"
        class="inline-flex size-target-min items-center justify-center rounded-control pointer-coarse:size-target-touch"
      >
        <ChevronsUpDown class="size-icon-sm text-text-secondary" aria-hidden="true" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal :to="portal">
      <ComboboxContent position="popper" :side-offset="4" :aria-label="$t('ui-combobox-list')" :class="panelClass">
        <ComboboxViewport>
          <ComboboxEmpty class="px-2 py-1.5 text-caption text-text-secondary">{{
            $t("ui-combobox-empty")
          }}</ComboboxEmpty>
          <ComboboxItem
            v-for="option in props.options"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            :disabled="option.disabled === true"
            :aria-disabled="option.disabled === true || undefined"
            :class="cn(itemClass, 'pr-8')"
          >
            {{ option.label }}
            <ComboboxItemIndicator class="absolute right-2 inline-flex items-center">
              <Check class="size-icon-sm" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
