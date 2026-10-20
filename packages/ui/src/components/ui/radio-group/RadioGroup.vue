<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { RadioGroupRootEmits, RadioGroupRootProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { RadioGroupRoot, useForwardPropsEmits } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

const props = defineProps<RadioGroupRootProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<RadioGroupRootEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * An arrow key moves the focus to the next item and selects it, as in a group of native radio buttons (WAI-ARIA
 * radio group pattern). Reka UI selects the item only while the key is still down after the focus moves, so a
 * short key press can move the focus without a selection. The item handler moves the focus first. Then this
 * handler of the group selects the focused item.
 */
function selectFocused(event: KeyboardEvent): void {
  if (!ARROW_KEYS.has(event.key) || !(event.currentTarget instanceof HTMLElement)) return;
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    focused.getAttribute("role") === "radio" &&
    focused.getAttribute("aria-checked") !== "true" &&
    !focused.hasAttribute("data-disabled") &&
    event.currentTarget.contains(focused)
  ) {
    focused.click();
  }
}
</script>

<template>
  <RadioGroupRoot
    v-slot="slotProps"
    data-slot="radio-group"
    :class="cn('grid gap-3', props.class)"
    v-bind="forwardable(forwarded)"
    @keydown="selectFocused"
  >
    <slot v-bind="slotProps" />
  </RadioGroupRoot>
</template>
