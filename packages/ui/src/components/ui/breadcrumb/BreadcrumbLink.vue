<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts" setup>
// The link is at least the minimum target (24 px, WCAG 2.5.8): the item is a flex box, so the link is not inline.
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";
import { cn } from "../../../lib/utils";

const props = withDefaults(defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>(), {
  as: "a",
});
</script>

<template>
  <Primitive
    data-slot="breadcrumb-link"
    :as="as"
    :as-child="asChild"
    :class="cn('hover:text-foreground inline-flex min-h-target-min items-center transition-colors', props.class)"
  >
    <slot />
  </Primitive>
</template>
