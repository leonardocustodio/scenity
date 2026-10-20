<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { ComboboxViewportProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ComboboxViewport, useForwardProps } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<ComboboxViewportProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardProps(delegatedProps);
</script>

<template>
  <ComboboxViewport
    data-slot="combobox-viewport"
    v-bind="forwardable(forwarded)"
    :class="cn('max-h-75 scroll-py-1 overflow-x-hidden overflow-y-auto', props.class)"
  >
    <slot />
  </ComboboxViewport>
</template>
