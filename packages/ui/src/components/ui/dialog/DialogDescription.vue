<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DialogDescriptionProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DialogDescription, useForwardProps } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<DialogDescriptionProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DialogDescription
    data-slot="dialog-description"
    v-bind="forwardable(forwardedProps)"
    :class="cn('text-muted-foreground text-sm', props.class)"
  >
    <slot />
  </DialogDescription>
</template>
