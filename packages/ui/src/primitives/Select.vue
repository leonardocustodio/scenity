<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Select (Reka UI): one value from a short list. The trigger has a visible label through `id` and Label, or
 * an `aria-label`. The list opens in the portal target of the theme.
 */
import { useI18n } from "@scenity/i18n";
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { useInertWhileOpen } from "../lib/inert";
import { usePortalTarget } from "../lib/portal";
import type { ListOption } from "./options";
import { fieldVariants, itemClass, panelClass } from "./variants";

defineOptions({ name: "ScSelect", inheritAttrs: false });
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
useInertWhileOpen(open);
</script>

<template>
  <SelectRoot v-model="value" v-model:open="open" :disabled="props.disabled">
    <SelectTrigger
      v-bind="$attrs"
      :aria-invalid="props.invalid || undefined"
      :class="cn(fieldVariants(), 'justify-between', props.class)"
    >
      <SelectValue :placeholder="props.placeholder ?? $t('ui-select-placeholder')" />
      <SelectIcon><ChevronDown class="size-icon-sm text-text-secondary" aria-hidden="true" /></SelectIcon>
    </SelectTrigger>
    <SelectPortal :to="portal">
      <SelectContent
        position="popper"
        :side-offset="4"
        :class="cn(panelClass, 'max-h-(--reka-select-content-available-height)')"
      >
        <SelectViewport>
          <SelectItem
            v-for="option in props.options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled === true"
            :class="cn(itemClass, 'pr-8')"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="absolute right-2 inline-flex items-center">
              <Check class="size-icon-sm" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
