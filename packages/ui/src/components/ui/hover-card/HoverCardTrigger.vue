<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HoverCardTriggerProps } from "reka-ui";
import { HoverCardTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<HoverCardTriggerProps>();
</script>

<template>
  <HoverCardTrigger data-slot="hover-card-trigger" v-bind="forwardable(props)">
    <slot />
  </HoverCardTrigger>
</template>
