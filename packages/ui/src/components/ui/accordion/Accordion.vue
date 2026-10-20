<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AccordionRootEmits, AccordionRootProps } from "reka-ui";
import { AccordionRoot, useForwardPropsEmits } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<AccordionRootProps>();
const emits = defineEmits<AccordionRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <AccordionRoot v-slot="slotProps" data-slot="accordion" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </AccordionRoot>
</template>
