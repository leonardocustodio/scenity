<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DropdownMenuGroupProps } from "reka-ui";
import { DropdownMenuGroup } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<DropdownMenuGroupProps>();
</script>

<template>
  <DropdownMenuGroup data-slot="dropdown-menu-group" v-bind="forwardable(props)">
    <slot />
  </DropdownMenuGroup>
</template>
