<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { TooltipTriggerProps } from "reka-ui";
import { TooltipTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<TooltipTriggerProps>();
</script>

<template>
  <TooltipTrigger data-slot="tooltip-trigger" v-bind="forwardable(props)">
    <slot />
  </TooltipTrigger>
</template>
