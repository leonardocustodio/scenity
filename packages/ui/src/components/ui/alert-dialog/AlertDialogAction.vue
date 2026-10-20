<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AlertDialogActionProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { AlertDialogAction } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";
import { buttonVariants } from "../button";

const props = defineProps<AlertDialogActionProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <AlertDialogAction v-bind="forwardable(delegatedProps)" :class="cn(buttonVariants(), props.class)">
    <slot />
  </AlertDialogAction>
</template>
