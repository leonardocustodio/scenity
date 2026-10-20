<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { CollapsibleTriggerProps } from "reka-ui";
import { CollapsibleTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<CollapsibleTriggerProps>();
</script>

<template>
  <CollapsibleTrigger data-slot="collapsible-trigger" v-bind="forwardable(props)">
    <slot />
  </CollapsibleTrigger>
</template>
