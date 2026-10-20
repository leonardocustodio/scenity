// SPDX-License-Identifier: Apache-2.0
/**
 * The entries of a menu of the menu bar from the metadata of the commands: the commands of the menu, then a submenu
 * for each submenu ID. An entry shows the keys of its command. The entry of a command that cannot run is disabled and
 * gives the reason as its hint.
 */
import type { MenuCommand } from "./shell";

/** An entry of a menu (the `MenuEntry` of the ui package). */
export interface MenuBarEntry {
  readonly value: string;
  readonly label: string;
  readonly command?: string;
  readonly disabled?: boolean;
  readonly shortcut?: string;
  readonly hint?: string;
  readonly separated?: boolean;
  readonly children?: readonly MenuBarEntry[];
}

function entryOf(command: MenuCommand): MenuBarEntry {
  return {
    value: command.id,
    label: command.label,
    command: command.id,
    disabled: !command.available,
    ...(command.shortcut === "" ? {} : { shortcut: command.shortcut }),
    ...(command.reason === null ? {} : { hint: command.reason }),
  };
}

/** The entries of a menu. `translate` gives the label of a submenu (`menu-<menu>-<submenu>`). */
export function menuEntries(
  commands: readonly MenuCommand[],
  menu: string,
  translate: (id: string) => string,
): MenuBarEntry[] {
  const top = commands.filter((command) => command.menu === menu).map(entryOf);
  const subs = new Map<string, MenuBarEntry[]>();
  for (const command of commands) {
    const [head, sub] = command.menu.split("/");
    if (head !== menu || sub === undefined) continue;
    subs.set(sub, [...(subs.get(sub) ?? []), entryOf(command)]);
  }
  const nested = [...subs].map(([sub, children], index) => ({
    value: `${menu}/${sub}`,
    label: translate(`menu-${menu}-${sub}`),
    children,
    ...(index === 0 && top.length > 0 ? { separated: true } : {}),
  }));
  return [...top, ...nested];
}
