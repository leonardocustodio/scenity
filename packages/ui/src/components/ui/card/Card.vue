<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";
import { cn } from "../../../lib/utils";

// The element is <div> by default. A card that is a part of the page can be a <section> with as="section".
const props = withDefaults(defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>(), { as: "div" });
</script>

<template>
  <Primitive
    data-slot="card"
    :as="as"
    :as-child="asChild"
    :class="cn('bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm', props.class)"
  >
    <slot />
  </Primitive>
</template>
