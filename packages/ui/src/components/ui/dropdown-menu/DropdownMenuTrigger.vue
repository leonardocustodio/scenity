<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DropdownMenuTriggerProps } from "reka-ui";
import { DropdownMenuTrigger, useForwardProps } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<DropdownMenuTriggerProps>();

const forwardedProps = useForwardProps(props);
</script>

<template>
  <DropdownMenuTrigger data-slot="dropdown-menu-trigger" v-bind="forwardable(forwardedProps)">
    <slot />
  </DropdownMenuTrigger>
</template>
