<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Tabs (Reka UI): arrow keys move between tabs. Each tab has a slot with the name of its value. The list
 * wraps on a narrow screen, so the page does not scroll sideways at 320 px (WCAG 1.4.10).
 */
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScTabs" });

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const value = defineModel<string>({ default: "" });
const props = withDefaults(defineProps<{ tabs: readonly TabItem[]; label: string; class?: ClassValue | undefined }>(), {
  class: undefined,
});
</script>

<template>
  <TabsRoot v-model="value" :class="cn('flex flex-col gap-3', props.class)">
    <TabsList :aria-label="props.label" class="flex flex-wrap gap-1 border-b border-border-subtle">
      <TabsTrigger
        v-for="tab in props.tabs"
        :key="tab.value"
        :value="tab.value"
        :disabled="tab.disabled === true"
        class="-mb-px inline-flex min-h-10 items-center border-b-2 border-transparent px-3 text-label text-text-secondary pointer-coarse:min-h-target-touch hover:text-text-primary data-[state=active]:border-accent-brand data-[state=active]:text-text-primary data-[disabled]:opacity-(--sc-opacity-disabled)"
      >
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="tab in props.tabs" :key="tab.value" :value="tab.value" class="text-body">
      <slot :name="tab.value" />
    </TabsContent>
  </TabsRoot>
</template>
