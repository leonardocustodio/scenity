<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";
import { cn } from "../../../lib/utils";

// The element is <main> by default. A layout with its own <main> gives as="div".
const props = withDefaults(defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>(), { as: "main" });
</script>

<template>
  <Primitive
    data-slot="sidebar-inset"
    :as="as"
    :as-child="asChild"
    :class="
      cn(
        'bg-background relative flex w-full flex-1 flex-col',
        'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
        props.class,
      )
    "
  >
    <slot />
  </Primitive>
</template>
