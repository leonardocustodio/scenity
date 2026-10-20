<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The skip link (WCAG 2.4.1): the first focusable element of each layout. It is visible only when it has
 * the focus, and it moves the focus to the main content. The padding applies only with the focus, so the
 * hidden link has no box that a target-size check (WCAG 2.5.8) sees next to the first header link.
 */
import { useI18n } from "@scenity/i18n";
import { focusElement } from "./focus";

const props = withDefaults(defineProps<{ target?: string }>(), { target: "main" });
const { $t } = useI18n();

function skip(event: MouseEvent): void {
  const element = document.getElementById(props.target);
  if (element === null) return;
  event.preventDefault();
  focusElement(element);
}
</script>

<template>
  <a
    :href="`#${props.target}`"
    class="sr-only z-50 rounded-control bg-surface-overlay text-label text-text-primary shadow-overlay focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-4 focus:py-2"
    @click="skip"
    >{{ $t("ui-skip-to-main") }}</a
  >
</template>
