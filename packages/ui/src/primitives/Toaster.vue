<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Toaster (Reka UI ToastProvider and ToastViewport): it shows the toasts of `useToast()`. A toast stays while
 * the pointer or the keyboard focus is on it, and F8 moves the focus to the toast region (Reka UI).
 */
import { useI18n } from "@scenity/i18n";
import { X } from "lucide-vue-next";
import {
  ToastClose,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from "reka-ui";
import { provide, ref } from "vue";
import { usePortalTarget } from "../lib/portal";
import { TOAST_KEY, type ToastMessage } from "./toast";
import { buttonVariants } from "./variants";

defineOptions({ name: "ScToaster" });

interface Item extends ToastMessage {
  readonly id: number;
  open: boolean;
}

const props = withDefaults(defineProps<{ initial?: readonly ToastMessage[] }>(), { initial: () => [] });
const { $t } = useI18n();
const portal = usePortalTarget();
let next = 1;
const items = ref<Item[]>(props.initial.map((m) => ({ ...m, id: next++, open: true })));

provide(TOAST_KEY, {
  show(message: ToastMessage): void {
    items.value.push({ ...message, id: next++, open: true });
  },
});

/** The name of the toast region with the hotkey (Reka UI gives an English name by default). */
function viewportLabel(hotkey: string): string {
  return $t("ui-toast-viewport", { hotkey });
}

function closed(id: number, open: boolean): void {
  if (!open) items.value = items.value.filter((item) => item.id !== id);
}
</script>

<template>
  <ToastProvider :label="$t('ui-toast-region')">
    <slot />
    <ToastRoot
      v-for="item in items"
      :key="item.id"
      :open="item.open"
      :duration="item.durationMs ?? 6000"
      :type="item.tone === 'alert' ? 'foreground' : 'background'"
      class="flex items-start gap-3 rounded-card border border-border-subtle bg-surface-overlay p-3 text-text-primary shadow-overlay"
      @update:open="closed(item.id, $event)"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <ToastTitle class="text-label font-semibold">{{ item.title }}</ToastTitle>
        <ToastDescription v-if="item.description !== undefined" class="text-caption text-text-secondary">{{
          item.description
        }}</ToastDescription>
      </div>
      <ToastClose :aria-label="$t('ui-toast-close')" :class="buttonVariants({ variant: 'ghost', size: 'sm' })">
        <X class="size-icon-sm" aria-hidden="true" />
      </ToastClose>
    </ToastRoot>
    <ToastPortal :to="portal">
      <ToastViewport
        :label="viewportLabel"
        class="fixed right-0 bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4 outline-none"
      />
    </ToastPortal>
  </ToastProvider>
</template>
