<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PopoverRootEmits, PopoverRootProps } from "reka-ui";
import { PopoverRoot, useForwardPropsEmits } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<PopoverRootProps>();
const emits = defineEmits<PopoverRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <PopoverRoot v-slot="slotProps" data-slot="popover" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </PopoverRoot>
</template>
