<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { DialogOverlayProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DialogOverlay } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<DialogOverlayProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <DialogOverlay
    data-slot="sheet-overlay"
    :class="
      cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-surface-scrim',
        props.class,
      )
    "
    v-bind="forwardable(delegatedProps)"
  >
    <slot />
  </DialogOverlay>
</template>
