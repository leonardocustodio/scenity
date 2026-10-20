<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AlertDialogDescriptionProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { AlertDialogDescription } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<AlertDialogDescriptionProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <AlertDialogDescription
    data-slot="alert-dialog-description"
    v-bind="forwardable(delegatedProps)"
    :class="cn('text-muted-foreground text-sm', props.class)"
  >
    <slot />
  </AlertDialogDescription>
</template>
