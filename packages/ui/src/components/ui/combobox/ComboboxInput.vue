<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { ComboboxInputEmits, ComboboxInputProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { SearchIcon } from "lucide-vue-next";
import { reactiveOmit } from "@vueuse/core";
import { ComboboxInput, useForwardPropsEmits } from "reka-ui";
import { cn, forwardable } from "../../../lib/utils";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<
  ComboboxInputProps & {
    class?: HTMLAttributes["class"];
    /**
     * When true, the input is in a field (inside ComboboxAnchor). It has no search icon and no search-box frame
     * at the top of the list. Give the anchor the class "sc-field-focus" to show the focus ring on the anchor.
     */
    bare?: boolean;
  }
>();

const emits = defineEmits<ComboboxInputEmits>();

const delegatedProps = reactiveOmit(props, "class", "bare");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ComboboxInput
    v-if="bare"
    data-slot="combobox-input"
    :class="
      cn(
        'placeholder:text-muted-foreground min-w-0 flex-1 self-stretch bg-transparent px-3 text-sm outline-0 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
    v-bind="{ ...$attrs, ...forwardable(forwarded) }"
  >
    <slot />
  </ComboboxInput>
  <div v-else data-slot="command-input-wrapper" class="flex h-9 items-center gap-2 border-b px-3">
    <SearchIcon class="size-4 shrink-0 opacity-50" />
    <ComboboxInput
      data-slot="command-input"
      :class="
        cn(
          'placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50',
          props.class,
        )
      "
      v-bind="{ ...$attrs, ...forwardable(forwarded) }"
    >
      <slot />
    </ComboboxInput>
  </div>
</template>
