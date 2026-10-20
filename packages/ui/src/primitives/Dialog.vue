<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Dialog (Reka UI): a modal panel with a title and an optional description. Reka UI traps the focus in the
 * panel and gives it back to the trigger when the dialog closes. Escape and the close button close
 * it, unless `dismissible` is false.
 */
import { useI18n } from "@scenity/i18n";
import { X } from "lucide-vue-next";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "reka-ui";
import { useId } from "vue";
import { cn, type ClassValue } from "../lib/cn";
import { usePortalTarget } from "../lib/portal";
import { buttonVariants } from "./variants";

defineOptions({ name: "ScDialog" });

const open = defineModel<boolean>("open", { default: false });
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string | undefined;
    dismissible?: boolean;
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, description: undefined, dismissible: true },
);
const { $t } = useI18n();
const portal = usePortalTarget();
// Without a description the panel has no aria-describedby: a reference to a missing element is not valid
// ARIA (axe aria-valid-attr-value).
const descriptionId = useId();

function guard(event: Event): void {
  if (!props.dismissible) event.preventDefault();
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child><slot name="trigger" /></DialogTrigger>
    <DialogPortal :to="portal">
      <DialogOverlay class="fixed inset-0 z-40 bg-surface-scrim" />
      <DialogContent
        :class="
          cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-1/2 flex-col gap-4 overflow-auto',
            'rounded-card border border-border-subtle bg-surface-overlay p-6 text-text-primary shadow-overlay',
            props.class,
          )
        "
        :aria-describedby="props.description === undefined ? undefined : descriptionId"
        @escape-key-down="guard"
        @pointer-down-outside="guard"
        @interact-outside="guard"
      >
        <div class="flex items-start gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle class="text-title text-text-primary">{{ props.title }}</DialogTitle>
            <DialogDescription
              v-if="props.description !== undefined"
              :id="descriptionId"
              class="text-body text-text-secondary"
            >
              {{ props.description }}
            </DialogDescription>
          </div>
          <DialogClose
            v-if="props.dismissible"
            :aria-label="$t('ui-dialog-close')"
            :class="buttonVariants({ variant: 'ghost', size: 'icon' })"
          >
            <X class="size-icon-md" aria-hidden="true" />
          </DialogClose>
        </div>
        <slot />
        <div v-if="$slots.footer" class="flex flex-wrap justify-end gap-2"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
