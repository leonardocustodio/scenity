<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { SelectItemTextProps } from "reka-ui";
import { SelectItemText } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<SelectItemTextProps>();
</script>

<template>
  <SelectItemText data-slot="select-item-text" v-bind="forwardable(props)">
    <slot />
  </SelectItemText>
</template>
