<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { SelectRootEmits, SelectRootProps } from "reka-ui";
import { SelectRoot, useForwardPropsEmits } from "reka-ui";
import { ref } from "vue";
import { useInertWhileOpen } from "../../../lib/inert";
import { forwardable } from "../../../lib/utils";

const props = defineProps<SelectRootProps>();
const emits = defineEmits<SelectRootEmits>();

// While the list is open, Reka UI hides the rest of the page with aria-hidden. useInertWhileOpen also makes it
// inert, so it cannot take the focus (WCAG 4.1.2).
const open = ref(props.open || props.defaultOpen);
useInertWhileOpen(open);

const forwarded = useForwardPropsEmits(props, (name: string, ...args: unknown[]) => {
  if (name === "update:open") open.value = args[0] === true;
  (emits as (name: string, ...args: unknown[]) => void)(name, ...args);
});
</script>

<template>
  <SelectRoot v-slot="slotProps" data-slot="select" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </SelectRoot>
</template>
