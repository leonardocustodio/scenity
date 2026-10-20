<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { useI18n } from "@scenity/i18n";
import type { HTMLAttributes } from "vue";
import { Loader2Icon } from "lucide-vue-next";
import { cn } from "../../../lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
const { $t } = useI18n();
</script>

<template>
  <Loader2Icon role="status" :aria-label="$t('ui-loading')" :class="cn('size-4 animate-spin', props.class)" />
</template>
