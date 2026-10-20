<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PopoverTriggerProps } from "reka-ui";
import { PopoverTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<PopoverTriggerProps>();
</script>

<template>
  <PopoverTrigger data-slot="popover-trigger" v-bind="forwardable(props)">
    <slot />
  </PopoverTrigger>
</template>
