<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The dialog and the toasts of the editor window. There is one dialog that asks a question at a time. The focus goes
 * to its field, else to its safe action, and Escape is its dismiss action. The toasts of short facts are in a polite
 * live region, and they never take the focus.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Dialog } from "@scenity/ui";
import { X } from "lucide-vue-next";
import type { DialogAction, WindowNotices } from "./dialogs";

const props = defineProps<{ notices: WindowNotices }>();
const { $t } = useI18n();
const request = computed(() => props.notices.state.dialog?.request ?? null);
const text = ref("");
const actions = ref<HTMLElement | null>(null);

watch(request, async (now) => {
  text.value = now?.input?.value ?? "";
  if (now === null || now.input !== undefined) return;
  await nextTick();
  // The focus goes to the safe action. Before that, Reka UI gives it to the first action.
  requestAnimationFrame(() => {
    const safe = now.safe ?? now.actions[0]?.id;
    actions.value?.querySelector<HTMLButtonElement>(`[data-action="${safe ?? ""}"]`)?.focus();
  });
});

function blocked(action: DialogAction): boolean {
  return action.needsText === true && text.value.trim() === "";
}

function run(action: DialogAction): void {
  if (!blocked(action)) props.notices.answer(action.id, text.value.trim());
}

/** Enter in the field runs the first action, as a press of it does. */
function submit(): void {
  const first = request.value?.actions[0];
  if (first !== undefined) run(first);
}

function onOpen(open: boolean): void {
  if (open) return;
  const dismiss = request.value?.dismiss;
  if (dismiss === undefined || dismiss === null) props.notices.close();
  else props.notices.answer(dismiss, "");
}

const variant = (action: DialogAction): "primary" | "secondary" | "ghost" =>
  action.tone === "primary" ? "primary" : action.tone === "plain" ? "ghost" : "secondary";
</script>

<template>
  <Dialog
    :open="request !== null"
    :title="request?.title ?? ''"
    :dismissible="request?.dismiss !== null"
    @update:open="onOpen"
  >
    <div
      v-if="request !== null"
      class="flex flex-col gap-3"
      :data-testid="request.testId"
      :data-kind="request.kind"
      :data-spec="request.spec"
    >
      <p class="text-body" :data-testid="request.textTestId">{{ request.text }}</p>
      <details v-if="request.details !== undefined" class="text-caption" data-testid="dialog-details">
        <summary class="cursor-default">{{ request.details.label }}</summary>
        <div v-if="request.details.view !== undefined" class="mt-1 max-h-64 overflow-auto">
          <component :is="request.details.view.component" v-bind="request.details.view.props" />
        </div>
        <ul v-else class="mt-1 max-h-48 overflow-auto pl-4" translate="no">
          <li v-for="(line, index) in request.details.lines" :key="index" data-testid="dialog-detail">{{ line }}</li>
        </ul>
      </details>
      <input
        v-if="request.input !== undefined"
        v-model="text"
        type="text"
        maxlength="500"
        :aria-label="request.input.label"
        :placeholder="request.input.label"
        :data-testid="request.input.testId"
        class="min-h-10 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
        @keydown.enter.prevent="submit"
      />
      <div ref="actions" class="flex flex-wrap justify-end gap-2">
        <Button
          v-for="action in request.actions"
          :key="action.id"
          :variant="variant(action)"
          :class="action.tone === 'danger' ? 'text-status-negative' : undefined"
          :disabled="blocked(action)"
          :data-action="action.id"
          :data-testid="action.testId"
          @click="run(action)"
        >
          {{ action.label }}
        </Button>
      </div>
    </div>
  </Dialog>
  <div class="studio-toasts" role="status" aria-live="polite" data-testid="studio-toasts">
    <div
      v-for="toast in props.notices.state.toasts"
      :key="toast.id"
      class="studio-toast"
      :data-tone="toast.tone"
      data-testid="studio-toast"
    >
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{{ toast.title }}</p>
        <p v-if="toast.text !== undefined" class="text-text-secondary">{{ toast.text }}</p>
      </div>
      <button
        type="button"
        class="studio-toast-close"
        :aria-label="$t('notice-dismiss')"
        tabindex="-1"
        @click="props.notices.dropToast(toast.id)"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
