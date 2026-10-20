<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { ComboboxRootEmits, ComboboxRootProps } from "reka-ui";
import { ComboboxRoot, useForwardPropsEmits } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<ComboboxRootProps>();
const emits = defineEmits<ComboboxRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <ComboboxRoot v-slot="slotProps" data-slot="combobox" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </ComboboxRoot>
</template>
