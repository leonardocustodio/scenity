<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { PaginationListProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { PaginationList } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<PaginationListProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <PaginationList
    v-slot="slotProps"
    data-slot="pagination-content"
    v-bind="forwardable(delegatedProps)"
    :class="cn('flex flex-row items-center gap-1', props.class)"
  >
    <slot v-bind="slotProps" />
  </PaginationList>
</template>
