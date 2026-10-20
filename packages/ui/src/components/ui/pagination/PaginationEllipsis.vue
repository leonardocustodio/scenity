<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { useI18n } from "@scenity/i18n";
import type { PaginationEllipsisProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import { reactiveOmit } from "@vueuse/core";
import { PaginationEllipsis } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<PaginationEllipsisProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
const { $t } = useI18n();
</script>

<template>
  <PaginationEllipsis
    data-slot="pagination-ellipsis"
    v-bind="forwardable(delegatedProps)"
    :class="cn('flex size-9 items-center justify-center', props.class)"
  >
    <slot>
      <MoreHorizontal class="size-4" />
      <span class="sr-only">{{ $t("ui-breadcrumb-more") }}</span>
    </slot>
  </PaginationEllipsis>
</template>
