<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { SelectValueProps } from "reka-ui";
import { SelectValue } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<SelectValueProps>();
</script>

<template>
  <SelectValue data-slot="select-value" v-bind="forwardable(props)">
    <slot />
  </SelectValue>
</template>
