<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AlertDialogTitleProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { AlertDialogTitle } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<AlertDialogTitleProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <AlertDialogTitle
    data-slot="alert-dialog-title"
    v-bind="forwardable(delegatedProps)"
    :class="cn('text-lg font-semibold', props.class)"
  >
    <slot />
  </AlertDialogTitle>
</template>
