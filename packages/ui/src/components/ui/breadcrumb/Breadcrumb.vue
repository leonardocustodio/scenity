<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts" setup>
import { useI18n } from "@scenity/i18n";
import type { HTMLAttributes } from "vue";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
const { $t } = useI18n();
</script>

<template>
  <nav :aria-label="$t('ui-breadcrumb')" data-slot="breadcrumb" :class="props.class">
    <slot />
  </nav>
</template>
