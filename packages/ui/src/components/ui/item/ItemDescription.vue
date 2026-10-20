<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// No line clamp: text with larger spacing (WCAG 1.4.12) wraps and is never cut.
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <p
    data-slot="item-description"
    :class="
      cn(
        'text-muted-foreground text-sm leading-normal font-normal text-balance',
        '[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4',
        props.class,
      )
    "
  >
    <slot />
  </p>
</template>
