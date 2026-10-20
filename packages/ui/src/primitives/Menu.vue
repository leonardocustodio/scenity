<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Menu (Reka UI DropdownMenu): a list of commands behind a trigger button. Give the trigger in the slot. An entry can
 * show its keys, say why it is off (`hint`, the tooltip and the description of a disabled entry), and open a submenu
 * (`children`).
 */
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "reka-ui";
import { cn } from "../lib/cn";
import { usePortalTarget } from "../lib/portal";
import type { ListOption } from "./options";
import { itemClass, panelClass } from "./variants";

/** A long menu scrolls in the space that the window has (for example, the Edit menu has many items). */
const SCROLL = "max-h-(--reka-dropdown-menu-content-available-height) overflow-y-auto";

defineOptions({ name: "ScMenu" });

export interface MenuEntry extends ListOption {
  /** Draw a separator above this entry. */
  readonly separated?: boolean;
  /** The ID of the command that the entry runs (the `data-command` of the item). */
  readonly command?: string;
  /** The keys of the entry as text, for example "⌘S". */
  readonly shortcut?: string;
  /** Why the entry is off (a disabled entry shows it as its tooltip and its description). */
  readonly hint?: string;
  /** The entries of a submenu: the entry opens it. */
  readonly children?: readonly MenuEntry[];
}

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ items: readonly MenuEntry[] }>();
const emit = defineEmits<{ select: [value: string] }>();
const portal = usePortalTarget();
// A disabled entry with a hint takes the pointer, so its tooltip shows.
const hinted = "data-[disabled]:pointer-events-auto";
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal :to="portal">
      <DropdownMenuContent :side-offset="4" align="start" :class="cn(panelClass, SCROLL)">
        <template v-for="item in props.items" :key="item.value">
          <DropdownMenuSeparator v-if="item.separated === true" class="my-1 h-px bg-border-subtle" />
          <DropdownMenuSub v-if="item.children !== undefined">
            <DropdownMenuSubTrigger :disabled="item.disabled === true" :class="cn(itemClass)">
              <span class="flex-1">{{ item.label }}</span
              ><span aria-hidden="true">▸</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal :to="portal">
              <DropdownMenuSubContent :side-offset="2" :class="cn(panelClass, SCROLL)">
                <DropdownMenuItem
                  v-for="child in item.children"
                  :key="child.value"
                  :disabled="child.disabled === true"
                  :data-command="child.command"
                  :title="child.hint"
                  :aria-description="child.hint"
                  :class="cn(itemClass, child.hint !== undefined && hinted)"
                  @select="emit('select', child.value)"
                >
                  <span class="flex-1">{{ child.label }}</span>
                  <kbd v-if="child.shortcut" class="text-caption text-text-secondary" translate="no">{{
                    child.shortcut
                  }}</kbd>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem
            v-else
            :disabled="item.disabled === true"
            :data-command="item.command"
            :title="item.hint"
            :aria-description="item.hint"
            :class="cn(itemClass, item.hint !== undefined && hinted)"
            @select="emit('select', item.value)"
          >
            <span class="flex-1">{{ item.label }}</span>
            <kbd v-if="item.shortcut" class="text-caption text-text-secondary" translate="no">{{ item.shortcut }}</kbd>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
