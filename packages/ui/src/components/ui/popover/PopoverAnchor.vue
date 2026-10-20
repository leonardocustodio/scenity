<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PopoverAnchorProps } from "reka-ui";
import { PopoverAnchor } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<PopoverAnchorProps>();
</script>

<template>
  <PopoverAnchor data-slot="popover-anchor" v-bind="forwardable(props)">
    <slot />
  </PopoverAnchor>
</template>
