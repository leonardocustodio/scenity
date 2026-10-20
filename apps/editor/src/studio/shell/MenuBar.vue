<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The menu bar of the editor window: File, Edit, Assets, Entity, Component, Sequence, Agent, Build, Window and Help.
 * The menus come from the metadata of the commands (the `menu` of a command). An entry shows its keys. An entry of a
 * command that cannot run is disabled and tells the reason. A menu with no command does not show. The Window menu is
 * the menu of the dock (WindowMenu.vue) with the panels and their actions.
 */
import { onBeforeUnmount, shallowRef } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Menu } from "@scenity/ui";
import type { Dock } from "./dock";
import type { ShellCommandSpec } from "./dockCommands";
import { menuEntries } from "./menuEntries";
import type { PanelRegistry } from "./panels";
import type { CommandPort, MenuCommand } from "./shell";
import WindowMenu from "./WindowMenu.vue";

const props = defineProps<{
  dock: Dock;
  registry: PanelRegistry;
  commands: readonly ShellCommandSpec[];
  port?: CommandPort | undefined;
}>();
const { $t } = useI18n();

/** The menus of the bar in their order. "window" is the menu of the dock. */
const MENUS = [
  "file",
  "edit",
  "assets",
  "entity",
  "component",
  "sequence",
  "agent",
  "build",
  "window",
  "help",
] as const;

// The menu bar reads the commands again after each change of the registry and when a menu opens. Thus the state of
// each command is current.
const snapshot = shallowRef<readonly MenuCommand[]>(props.port?.menuCommands() ?? []);
const read = (): void => {
  snapshot.value = props.port?.menuCommands() ?? [];
};
onBeforeUnmount(props.port?.listen(read) ?? (() => undefined));

function run(id: string): void {
  props.port?.run(id);
}
</script>

<template>
  <nav class="studio-menubar" :aria-label="$t('menu-bar')" data-testid="menu-bar">
    <template v-for="menu in MENUS" :key="menu">
      <WindowMenu
        v-if="menu === 'window'"
        :dock="props.dock"
        :registry="props.registry"
        :commands="props.commands"
        :port="props.port"
      />
      <Menu
        v-else-if="menuEntries(snapshot, menu, $t).length > 0"
        :items="menuEntries(snapshot, menu, $t)"
        @update:open="$event && read()"
        @select="run"
      >
        <template #trigger>
          <Button size="sm" variant="ghost" :data-testid="`menu-${menu}`">{{ $t(`menu-${menu}`) }}</Button>
        </template>
      </Menu>
    </template>
  </nav>
</template>
