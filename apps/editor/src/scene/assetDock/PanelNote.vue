<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** The content of a panel whose part the page does not have (a scene with no sequence): one line that says why. */
import { useI18n } from "@scenity/i18n";

const props = defineProps<{ text: string }>();
const { $t } = useI18n();
</script>

<template>
  <p class="p-3 text-caption text-text-secondary" role="status">{{ $t(props.text) }}</p>
</template>
