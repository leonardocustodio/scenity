<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DialogCloseProps } from "reka-ui";
import { DialogClose } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<DialogCloseProps>();
</script>

<template>
  <DialogClose data-slot="dialog-close" v-bind="forwardable(props)">
    <slot />
  </DialogClose>
</template>
