<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DialogRootEmits, DialogRootProps } from "reka-ui";
import { DialogRoot, useForwardPropsEmits } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<DialogRootProps>();
const emits = defineEmits<DialogRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DialogRoot v-slot="slotProps" data-slot="sheet" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </DialogRoot>
</template>
