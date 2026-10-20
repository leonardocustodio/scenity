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
  <div data-slot="alert-title" :class="cn('col-start-2 min-h-4 font-medium tracking-tight', props.class)">
    <slot />
  </div>
</template>
