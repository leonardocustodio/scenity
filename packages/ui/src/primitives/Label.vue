<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Label (Reka UI): the visible name of a form control. */
import { Label } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScLabel" });

const props = withDefaults(defineProps<{ for?: string | undefined; class?: ClassValue | undefined }>(), {
  class: undefined,
  for: undefined,
});
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/label-has-for -- The caller gives "for", or nests the control. -->
  <Label
    v-bind="props.for === undefined ? {} : { for: props.for }"
    :class="cn('text-label font-medium text-text-primary peer-disabled:opacity-(--sc-opacity-disabled)', props.class)"
  >
    <slot />
  </Label>
</template>
