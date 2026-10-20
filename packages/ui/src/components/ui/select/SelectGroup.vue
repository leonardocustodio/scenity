<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { SelectGroupProps } from "reka-ui";
import { SelectGroup } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<SelectGroupProps>();
</script>

<template>
  <SelectGroup data-slot="select-group" v-bind="forwardable(props)">
    <slot />
  </SelectGroup>
</template>
