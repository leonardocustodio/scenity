// SPDX-License-Identifier: Apache-2.0
/** The Shortcuts window of the editor window: the key map on a keyboard picture. */
import type { StudioShell } from "../../studio/shell/shell";
import ShortcutsPanel from "./ShortcutsPanel.vue";

/** Give the Shortcuts window its content. */
export function startShortcuts(shell: Pick<StudioShell, "setPanel">): void {
  shell.setPanel("shortcuts", { component: ShortcutsPanel, props: {} });
}
