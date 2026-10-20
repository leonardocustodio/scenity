<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

interface SkeletonProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<SkeletonProps>();
</script>

<template>
  <!-- sc-motion: the in-app setting "reduced motion" stops the pulse too (styles/index.css). -->
  <div data-slot="skeleton" :class="cn('sc-motion rounded-md bg-primary/10 motion-safe:animate-pulse', props.class)" />
</template>
