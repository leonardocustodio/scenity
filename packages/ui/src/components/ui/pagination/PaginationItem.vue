<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PaginationListItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import type { ButtonVariants } from "../button";
import { reactiveOmit } from "@vueuse/core";
import { PaginationListItem } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";
import { buttonVariants } from "../button";

const props = withDefaults(
  defineProps<
    PaginationListItemProps & {
      size?: ButtonVariants["size"];
      class?: HTMLAttributes["class"];
      isActive?: boolean;
    }
  >(),
  {
    size: "icon",
  },
);

const delegatedProps = reactiveOmit(props, "class", "size", "isActive");
</script>

<template>
  <PaginationListItem
    data-slot="pagination-item"
    v-bind="forwardable(delegatedProps)"
    :class="
      cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        props.class,
      )
    "
  >
    <slot />
  </PaginationListItem>
</template>
