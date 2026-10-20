<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Layout menu of the toolbar of the editor window: Save as…, Rename…, Delete and Reset. A change of the layout is
 * kept immediately. Reset restores the default layout of the workspace. Each entry runs a command of the shell
 * (dockCommands.ts). Save as and Rename ask for the name in a dialog of the window.
 */
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Menu } from "@scenity/ui";
import { ChevronDown } from "lucide-vue-next";
import type { Dock } from "./dock";
import { runShellCommand, type ShellCommandSpec } from "./dockCommands";

const props = defineProps<{ dock: Dock; commands: readonly ShellCommandSpec[] }>();
const { $t } = useI18n();
// The menu reads the workspaces again after each change, because an entry of a workspace of the person can become
// enabled or disabled. Thus the key of the menu changes.
const version = ref(0);
const stop = props.dock.workspaces.listen(() => (version.value += 1));
onBeforeUnmount(stop);

/** An entry of the menu (the `MenuEntry` of the ui package). */
interface Entry {
  readonly value: string;
  readonly command: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly separated?: boolean;
}

function entry(command: string, label: string, separated = false): Entry {
  const spec = props.commands.find((item) => item.id === command);
  const disabled = spec === undefined || (spec.when?.() ?? null) !== null;
  return { value: command, command, label, disabled, ...(separated ? { separated } : {}) };
}

function items(): Entry[] {
  return [
    entry("layout.saveAs", $t("layout-save-as")),
    entry("layout.rename", $t("layout-rename")),
    entry("layout.delete", $t("layout-delete")),
    entry("layout.reset", $t("layout-reset"), true),
  ];
}
</script>

<template>
  <Menu :key="version" :items="items()" @select="runShellCommand(props.commands, $event)">
    <template #trigger>
      <Button size="sm" variant="ghost" data-testid="menu-layout">
        {{ $t("layout-menu") }}<ChevronDown class="size-icon-sm" aria-hidden="true" />
      </Button>
    </template>
  </Menu>
</template>
