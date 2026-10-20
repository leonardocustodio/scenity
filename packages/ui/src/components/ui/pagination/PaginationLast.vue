<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { useI18n } from "@scenity/i18n";
import type { PaginationLastProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import type { ButtonVariants } from "../button";
import { ChevronRightIcon } from "lucide-vue-next";
import { reactiveOmit } from "@vueuse/core";
import { PaginationLast, useForwardProps } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";
import { buttonVariants } from "../button";

const props = withDefaults(
  defineProps<
    PaginationLastProps & {
      size?: ButtonVariants["size"];
      class?: HTMLAttributes["class"];
    }
  >(),
  {
    size: "default",
  },
);

const delegatedProps = reactiveOmit(props, "class", "size");
const forwarded = useForwardProps(delegatedProps);
const { $t } = useI18n();
</script>

<template>
  <PaginationLast
    data-slot="pagination-last"
    :class="cn(buttonVariants({ variant: 'ghost', size }), 'gap-1 px-2.5 sm:pr-2.5', props.class)"
    v-bind="forwardable(forwarded)"
  >
    <slot>
      <span class="hidden sm:block">{{ $t("ui-pagination-last") }}</span>
      <ChevronRightIcon />
    </slot>
  </PaginationLast>
</template>
