<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { useI18n } from "@scenity/i18n";
import type { HTMLAttributes } from "vue";
import { DialogClose } from "reka-ui";
import { cn } from "../../../lib/utils";
import { Button } from "../button";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    showCloseButton?: boolean;
  }>(),
  {
    showCloseButton: false,
  },
);
const { $t } = useI18n();
</script>

<template>
  <div data-slot="dialog-footer" :class="cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', props.class)">
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="outline">{{ $t("ui-dialog-close") }}</Button>
    </DialogClose>
  </div>
</template>
