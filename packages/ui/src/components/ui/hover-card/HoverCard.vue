<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HoverCardRootEmits, HoverCardRootProps } from "reka-ui";
import { HoverCardRoot, useForwardPropsEmits } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<HoverCardRootProps>();
const emits = defineEmits<HoverCardRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <HoverCardRoot v-slot="slotProps" data-slot="hover-card" v-bind="forwardable(forwarded)">
    <slot v-bind="slotProps" />
  </HoverCardRoot>
</template>
