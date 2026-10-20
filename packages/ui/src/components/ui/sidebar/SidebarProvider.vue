<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { HTMLAttributes, Ref } from "vue";
import { useEventListener, useMediaQuery, useVModel } from "@vueuse/core";
import { TooltipProvider } from "reka-ui";
import { computed, ref } from "vue";
import { cn } from "../../../lib/utils";
import {
  provideSidebarContext,
  SIDEBAR_KEYBOARD_SHORTCUT,
  SIDEBAR_DESKTOP_QUERY,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_ICON,
} from "./utils";

const props = withDefaults(
  defineProps<{
    defaultOpen?: boolean;
    open?: boolean | undefined;
    class?: HTMLAttributes["class"];
  }>(),
  {
    defaultOpen: true,
    open: undefined,
  },
);

const emits = defineEmits<{
  "update:open": [open: boolean];
}>();

const isDesktop = useMediaQuery(SIDEBAR_DESKTOP_QUERY);
const isMobile = computed(() => !isDesktop.value);
const openMobile = ref(false);

// The caller keeps the state with v-model:open, or the provider keeps it from defaultOpen.
// useVModel gives defaultOpen in place of undefined, so the value is a boolean.
const open = useVModel(props, "open", emits, { defaultValue: props.defaultOpen, passive: true }) as Ref<boolean>;

function setOpen(value: boolean) {
  open.value = value;
}

function setOpenMobile(value: boolean) {
  openMobile.value = value;
}

// Open or close the sidebar (the sheet on a mobile screen).
function toggleSidebar() {
  if (isMobile.value) setOpenMobile(!openMobile.value);
  else setOpen(!open.value);
}

useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    toggleSidebar();
  }
});

// The state gives data-state="expanded" or "collapsed" to the sidebar.
// Tailwind classes use this attribute to style the sidebar.
const state = computed(() => (open.value ? "expanded" : "collapsed"));

provideSidebarContext({
  state,
  open,
  setOpen,
  isMobile,
  openMobile,
  setOpenMobile,
  toggleSidebar,
});
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <div
      data-slot="sidebar-wrapper"
      :style="{
        '--sidebar-width': SIDEBAR_WIDTH,
        '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
      }"
      :class="cn('group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full', props.class)"
      v-bind="$attrs"
    >
      <slot />
    </div>
  </TooltipProvider>
</template>
