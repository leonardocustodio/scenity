<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { TooltipProviderProps } from "reka-ui";
import { TooltipProvider } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 0,
});
</script>

<template>
  <TooltipProvider v-bind="forwardable(props)">
    <slot />
  </TooltipProvider>
</template>
