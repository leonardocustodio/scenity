<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";
import { cn } from "../../../lib/utils";

// The element is <h3> by default. Give the heading level of the page with `as`, for example as="h2".
// A long word wraps, so the card does not widen the page (WCAG 1.4.10).
const props = withDefaults(defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>(), { as: "h3" });
</script>

<template>
  <Primitive
    data-slot="card-title"
    :as="as"
    :as-child="asChild"
    :class="cn('min-w-0 leading-none font-semibold wrap-break-word', props.class)"
  >
    <slot />
  </Primitive>
</template>
