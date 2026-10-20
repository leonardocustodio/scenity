<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <p data-slot="card-description" :class="cn('text-muted-foreground min-w-0 text-sm wrap-break-word', props.class)">
    <slot />
  </p>
</template>
