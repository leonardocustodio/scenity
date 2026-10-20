<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AcceptableValue } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { ChevronDownIcon } from "lucide-vue-next";
import { reactiveOmit, useVModel } from "@vueuse/core";
import { cn, forwardable } from "../../../lib/utils";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{ modelValue?: AcceptableValue | AcceptableValue[]; class?: HTMLAttributes["class"] }>();

const emit = defineEmits<{
  "update:modelValue": [value: AcceptableValue | AcceptableValue[]];
}>();

const modelValue = useVModel(props, "modelValue", emit, {
  passive: true,
  defaultValue: "",
});

// The select gets the model through v-model, not as an attribute.
const delegatedProps = reactiveOmit(props, "class", "modelValue");
</script>

<template>
  <div class="group/native-select relative w-fit has-[select:disabled]:opacity-50" data-slot="native-select-wrapper">
    <select
      v-bind="{ ...$attrs, ...forwardable(delegatedProps) }"
      v-model="modelValue"
      data-slot="native-select"
      :class="
        cn(
          'border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 appearance-none pointer-coarse:min-h-target-touch rounded-md border bg-transparent px-3 py-2 pr-9 text-sm shadow-xs transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed',
          '',
          'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
          props.class,
        )
      "
    >
      <slot />
    </select>
    <ChevronDownIcon
      class="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 opacity-50 select-none"
      aria-hidden="true"
      data-slot="native-select-icon"
    />
  </div>
</template>
