<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DialogTriggerProps } from "reka-ui";
import { DialogTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<DialogTriggerProps>();
</script>

<template>
  <DialogTrigger data-slot="sheet-trigger" v-bind="forwardable(props)">
    <slot />
  </DialogTrigger>
</template>
