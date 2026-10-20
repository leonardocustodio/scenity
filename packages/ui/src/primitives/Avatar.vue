<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Avatar (Reka UI): a portrait with initials as the fallback. `alt` names the person. */
import { AvatarFallback, AvatarImage, AvatarRoot } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { initials } from "../lib/initials";

defineOptions({ name: "ScAvatar" });

const props = withDefaults(
  defineProps<{ name: string; src?: string | undefined; size?: "sm" | "md" | "lg"; class?: ClassValue | undefined }>(),
  { class: undefined, src: undefined, size: "md" },
);
const SIZE = { sm: "size-8 text-caption", md: "size-10 text-label", lg: "size-14 text-title" } as const;
</script>

<template>
  <AvatarRoot
    :class="
      cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-border-strong bg-surface-sunken',
        SIZE[props.size],
        props.class,
      )
    "
  >
    <AvatarImage v-if="props.src !== undefined" :src="props.src" :alt="props.name" class="size-full object-cover" />
    <AvatarFallback role="img" :aria-label="props.name" class="font-semibold text-text-primary">
      <span aria-hidden="true">{{ initials(props.name) }}</span>
    </AvatarFallback>
  </AvatarRoot>
</template>
