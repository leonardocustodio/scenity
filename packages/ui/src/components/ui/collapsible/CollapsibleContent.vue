<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { CollapsibleContentProps } from "reka-ui";
import { CollapsibleContent } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<CollapsibleContentProps>();
</script>

<template>
  <CollapsibleContent data-slot="collapsible-content" v-bind="forwardable(props)">
    <slot />
  </CollapsibleContent>
</template>
