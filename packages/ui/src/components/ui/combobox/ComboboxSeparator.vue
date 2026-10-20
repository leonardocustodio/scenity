<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { ComboboxSeparatorProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ComboboxSeparator } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<ComboboxSeparatorProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <ComboboxSeparator
    data-slot="combobox-separator"
    v-bind="forwardable(delegatedProps)"
    :class="cn('bg-border -mx-1 h-px', props.class)"
  >
    <slot />
  </ComboboxSeparator>
</template>
