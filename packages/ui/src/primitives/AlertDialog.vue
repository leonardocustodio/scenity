<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * AlertDialog (Reka UI, role="alertdialog"): a confirmation that needs an answer, for example "Delete this
 * scene?". It does not close on an outside click. The focus starts on the cancel button.
 */
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "reka-ui";
import { usePortalTarget } from "../lib/portal";
import { buttonVariants } from "./variants";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ title: string; description: string; confirmLabel: string; cancelLabel: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const portal = usePortalTarget();
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogTrigger v-if="$slots.trigger" as-child><slot name="trigger" /></AlertDialogTrigger>
    <AlertDialogPortal :to="portal">
      <AlertDialogOverlay class="fixed inset-0 z-40 bg-surface-scrim" />
      <AlertDialogContent
        class="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-1/2 flex-col gap-4 rounded-card border border-border-subtle bg-surface-overlay p-6 text-text-primary shadow-overlay"
      >
        <AlertDialogTitle class="text-title">{{ props.title }}</AlertDialogTitle>
        <AlertDialogDescription class="text-body text-text-secondary">{{ props.description }}</AlertDialogDescription>
        <div class="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel :class="buttonVariants({ variant: 'secondary' })" @click="emit('cancel')">{{
            props.cancelLabel
          }}</AlertDialogCancel>
          <AlertDialogAction :class="buttonVariants({ variant: 'primary' })" @click="emit('confirm')">{{
            props.confirmLabel
          }}</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
