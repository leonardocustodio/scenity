<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AlertDialogTriggerProps } from "reka-ui";
import { AlertDialogTrigger } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<AlertDialogTriggerProps>();
</script>

<template>
  <AlertDialogTrigger data-slot="alert-dialog-trigger" v-bind="forwardable(props)">
    <slot />
  </AlertDialogTrigger>
</template>
