<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Window menu of the editor window. It shows each panel of the registry, then the actions on the active panel
 * (maximize, float, copy, move to an area, close, the next panel). Then it shows the reset of the layout and the
 * submenus of the page commands. The menu works by keyboard (Reka UI), so each dock action works with no pointer.
 * Each entry runs a command of the shell (dockCommands.ts) or a command of the page.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Menu } from "@scenity/ui";
import type { Dock } from "./dock";
import { runShellCommand, type ShellCommandSpec } from "./dockCommands";
import { menuEntries, type MenuBarEntry } from "./menuEntries";
import type { PanelArea, PanelRegistry } from "./panels";
import type { CommandPort } from "./shell";

const props = defineProps<{
  dock: Dock;
  registry: PanelRegistry;
  commands: readonly ShellCommandSpec[];
  port?: CommandPort | undefined;
}>();
const { $t } = useI18n();
const AREAS: readonly PanelArea[] = ["left", "centre", "right", "bottom"];

/**
 * An entry of the menu (the `MenuEntry` of the ui package). The value is the command ID. The entry of a command that
 * cannot run is off.
 */
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

function items(): (Entry | MenuBarEntry)[] {
  const panels = props.registry
    .list()
    .filter((spec) => props.registry.available(spec.id))
    .map((spec) => entry(`panel.open.${spec.id}`, $t(spec.title)));
  return [
    ...panels,
    entry("panel.maximize", $t("window-maximize"), true),
    entry("panel.float", $t("window-float")),
    entry("panel.copy", $t("window-copy")),
    ...AREAS.map((area) => entry(`panel.move.${area}`, $t(`window-move-${area}`))),
    entry("panel.close", $t("window-close")),
    entry("panel.next", $t("window-next")),
    entry("layout.reset", $t("window-reset"), true),
    // The submenus of the Window menu come from the metadata of the commands (for example, the theme).
    ...menuEntries(props.port?.menuCommands() ?? [], "window", $t).map((item, index) =>
      index === 0 ? { ...item, separated: true } : item,
    ),
  ];
}

/** Run the command of an entry: a command of the shell, else a command of the page. */
function select(id: string): void {
  if (props.commands.some((spec) => spec.id === id)) runShellCommand(props.commands, id);
  else props.port?.run(id);
}
</script>

<template>
  <Menu :items="items()" @select="select">
    <template #trigger>
      <Button size="sm" variant="ghost" data-testid="menu-window">{{ $t("menu-window") }}</Button>
    </template>
  </Menu>
</template>
