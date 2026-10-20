<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Button: a native button element with the token variants. */
import { cn, type ClassValue } from "../lib/cn";
import { buttonVariants, type ButtonVariants } from "./variants";

defineOptions({ name: "ScButton" });

const props = withDefaults(
  defineProps<{
    variant?: NonNullable<ButtonVariants["variant"]>;
    size?: NonNullable<ButtonVariants["size"]>;
    type?: "button" | "submit" | "reset";
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, variant: "secondary", size: "md", type: "button" },
);
</script>

<template>
  <button :type="props.type" :class="cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)">
    <slot />
  </button>
</template>
