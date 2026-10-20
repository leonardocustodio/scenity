<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AccordionItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { AccordionItem, useForwardProps } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<AccordionItemProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <AccordionItem
    v-slot="slotProps"
    data-slot="accordion-item"
    v-bind="forwardable(forwardedProps)"
    :class="cn('border-b last:border-b-0', props.class)"
  >
    <slot v-bind="slotProps" />
  </AccordionItem>
</template>
