<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Accordion (Reka UI): sections that open and close. Each section has a slot with the name of its value. */
import { ChevronDown } from "lucide-vue-next";
import { AccordionContent, AccordionHeader, AccordionItem, AccordionRoot, AccordionTrigger } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScAccordion" });

export interface AccordionSection {
  readonly value: string;
  readonly title: string;
  readonly disabled?: boolean;
}

const value = defineModel<string>({ default: "" });
const props = withDefaults(defineProps<{ sections: readonly AccordionSection[]; class?: ClassValue | undefined }>(), {
  class: undefined,
});
</script>

<template>
  <AccordionRoot
    v-model="value"
    type="single"
    collapsible
    :class="cn('flex flex-col divide-y divide-border-subtle', props.class)"
  >
    <AccordionItem
      v-for="section in props.sections"
      :key="section.value"
      :value="section.value"
      :disabled="section.disabled === true"
    >
      <AccordionHeader as="h3" class="flex">
        <AccordionTrigger
          class="group flex min-h-10 flex-1 items-center justify-between gap-2 py-2 text-left text-label font-semibold text-text-primary pointer-coarse:min-h-target-touch data-[disabled]:opacity-(--sc-opacity-disabled)"
        >
          {{ section.title }}
          <ChevronDown
            class="size-icon-sm shrink-0 text-text-secondary transition-transform duration-base ease-standard group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionContent class="pb-3 text-body text-text-primary"><slot :name="section.value" /></AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>
