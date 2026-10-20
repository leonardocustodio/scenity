// SPDX-License-Identifier: Apache-2.0
/**
 * The shell of the editor window: one Vue app with the top row, the dock and the status row. The plain DOM parts of
 * the scene page go into the regions of the shell (`regions`). The file bar goes into `bar`, and the gizmo bar goes
 * into `tools`. The canvas and the parts over it go into `view` (the Scene view panel). A Vue part gives the content
 * of its panel (`setPanel`). The canvas stays plain DOM, outside each reactive state.
 */
import type { InjectionKey, ShallowRef } from "vue";
import type { Dock, LayoutDefaults } from "./dock";
import type { ShellCommandSpec } from "./dockCommands";
import type { WindowNotices } from "./dialogs";
import type { KeyRow, WindowKeySheet } from "./keySheet";
import type { WindowSearch } from "./search";
import type { WindowStatus } from "./status";
import type { Workspaces } from "./workspaceState";
import type { PanelContent, PanelRegistry } from "./panels";

/** The regions of the shell for the plain DOM parts of the page. */
export interface ShellRegions {
  readonly bar: HTMLElement;
  readonly tools: HTMLElement;
  /** The clock group in the centre of the toolbar. */
  readonly clock: HTMLElement;
  readonly view: HTMLElement;
  readonly status: HTMLElement;
}

/** A command of the window as the menu bar shows it. */
export interface MenuCommand {
  readonly id: string;
  /** The menu ID, then a submenu ID (`edit`, `window/theme`). */
  readonly menu: string;
  /** The label of the entry in the language of the page. */
  readonly label: string;
  /** The first key of the command as text ("⌘S"), or "". */
  readonly shortcut: string;
  readonly available: boolean;
  readonly reason: string | null;
}

/** The commands of the window for the menu bar (the page gives them). */
export interface CommandPort {
  /** The commands with a menu, in the order of the registry. */
  menuCommands(): readonly MenuCommand[];
  /** Run a command; the reason when it cannot run. */
  run(id: string): string | null;
  /** True when the window has the command. Only the studio has the agent commands. */
  has?(id: string): boolean;
  /** Run a command with its arguments. */
  execute?(id: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** Call the listener after each change of the commands; the result stops it. */
  listen(listener: () => void): () => void;
  /** The current keys of the key map, for the key sheet. */
  keyRows(): readonly KeyRow[];
}

/** What the Vue parts of the shell share. */
export interface ShellContext {
  readonly registry: PanelRegistry;
  readonly regions: ShellRegions;
  readonly workspaces: Workspaces;
  /** The dialogs, the toasts and the banners of the window. */
  readonly notices: WindowNotices;
  /** The values of the status bar. */
  readonly status: WindowStatus;
  /** The key sheet of the window (none: no sheet). */
  readonly keySheet?: WindowKeySheet;
  /** The search box of the window (none: no box). */
  readonly search?: WindowSearch;
  /** The commands of the window for the menu bar (none: the menu bar has the Window menu only). */
  readonly commands?: CommandPort;
  /** The settings for a new layout (the bottom panel and height of the editor settings). */
  readonly defaults?: () => LayoutDefaults;
  /** The shell calls it when the dock is ready, with the commands of the shell (the page adds them to its key map). */
  ready(dock: Dock, commands: readonly ShellCommandSpec[]): void;
}

export const SHELL_KEY: InjectionKey<ShellContext> = Symbol("scenity.studio.shell");
/** The dock of the shell (null before it is ready). */
export const DOCK_KEY: InjectionKey<ShallowRef<Dock | null>> = Symbol("scenity.studio.dock");

/** The shell as the scene page uses it. */
export interface StudioShell {
  readonly registry: PanelRegistry;
  readonly regions: ShellRegions;
  readonly dock: Dock;
  readonly notices: WindowNotices;
  readonly status: WindowStatus;
  /** The search box of the window. */
  readonly search: WindowSearch;
  /** The key sheet of the window. */
  readonly keySheet: WindowKeySheet;
  /** Give a panel its content. */
  setPanel(id: string, content: PanelContent | null): void;
  /** Show a panel (open it in its default area when it is closed). */
  showPanel(id: string): void;
  unmount(): void;
}

let current: StudioShell | null = null;

/** The shell of this page, or null (a page with no edit mode, a unit test). */
export function currentShell(): StudioShell | null {
  return current;
}

export function setCurrentShell(shell: StudioShell | null): void {
  current = shell;
}

/** Make a region element of the shell. */
export function regionElement(name: string): HTMLElement {
  const element = document.createElement("div");
  element.className = `studio-region studio-${name}`;
  element.dataset.region = name;
  return element;
}
