<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import type { InputGroupVariants } from ".";
import { cn } from "../../../lib/utils";
import { inputGroupAddonVariants } from ".";

const props = withDefaults(
  defineProps<{
    align?: InputGroupVariants["align"];
    class?: HTMLAttributes["class"];
  }>(),
  {
    align: "inline-start",
  },
);
</script>

<template>
  <div
    role="group"
    data-slot="input-group-addon"
    :data-align="props.align"
    :class="cn(inputGroupAddonVariants({ align: props.align }), props.class)"
  >
    <slot />
  </div>
</template>
