<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { ComboboxTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ComboboxTrigger, useForwardProps } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<ComboboxTriggerProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardProps(delegatedProps);
</script>

<template>
  <ComboboxTrigger
    data-slot="combobox-trigger"
    v-bind="forwardable(forwarded)"
    :class="cn('', props.class)"
    tabindex="0"
  >
    <slot />
  </ComboboxTrigger>
</template>
