// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench keys. Each key is a ⌘ chord, so it does not collide with the keys of the lab (Space, B, /, the arrows,
 * comma, period, [ and ]). Three ways give the same action:
 *
 * - the page itself, when it has the focus (`pageAction`);
 * - the native menu of the labs app (`workbench-menu` with the ID of the action), in any focus;
 * - the lab bridge, in a browser, when the lab frame has the focus (the bridge event `key`, `keyAction`).
 *
 * ⌘R stays the "Reload Page" item of the native menu, and the browser also reloads with it.
 */
import { SURFACE_KEY_COUNT, WORKBENCH_KEY_CODES, type WorkbenchKey } from "@scenity/workbench-host/protocol";

/** The action of the surface key ⌘n: the tab at place n (1 to 9) in the order of the tabs. */
export type SurfaceAction = `surface-${number}`;
/** The actions of the workbench keys and of the menu items of the app. */
export type WorkbenchAction = "toggle-claude" | "focus-claude" | SurfaceAction | "restart-host";

/** The surface actions, ⌘1 to ⌘9. */
const SURFACE_ACTIONS: readonly SurfaceAction[] = Array.from(
  { length: SURFACE_KEY_COUNT },
  (_, at) => `surface-${String(at + 1)}` as SurfaceAction,
);

/**
 * The action of each workbench key: ⌘\ the Claude column, ⌘K the Claude prompt. ⌘1 to ⌘9 put the tab at that place
 * in front. The labels, the order and the hidden surfaces come from the project manifest (`host.hello`).
 */
export const KEY_ACTIONS: Readonly<Partial<Record<WorkbenchKey, WorkbenchAction>>> = {
  "\\": "toggle-claude",
  ...Object.fromEntries(SURFACE_ACTIONS.map((action, at) => [String(at + 1), action])),
  k: "focus-claude",
};

/** The menu ID of the first tab in the native menu of an older labs app. It means ⌘1. */
const OLD_FIRST_TAB = "surface-lab";
const ACTIONS: readonly string[] = [...Object.values(KEY_ACTIONS), "restart-host"];

/** The action of a menu event ID, or null for an ID of no workbench action. */
export function menuAction(id: unknown): WorkbenchAction | null {
  if (id === OLD_FIRST_TAB) return "surface-1";
  return typeof id === "string" && ACTIONS.includes(id) ? (id as WorkbenchAction) : null;
}

/** The action of a key that a lab frame sent, or null for a key without an action. */
export function keyAction(key: WorkbenchKey): WorkbenchAction | null {
  return KEY_ACTIONS[key] ?? null;
}

/** The place of the tab of a surface action (1 for ⌘1), or null for another action. */
export function surfaceOf(action: WorkbenchAction): number | null {
  const at = SURFACE_ACTIONS.indexOf(action as SurfaceAction);
  return at === -1 ? null : at + 1;
}

/** The key parts of a keydown event of the page. */
export interface PageKeyEvent {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
}

/** True for a text field, a text area (the terminal too) or an editable element. */
function editable(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (element === null || typeof element !== "object") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable === true;
}

/**
 * The action of a keydown event of the page, or null. ⌘ chords always count. A Ctrl chord counts only outside a text
 * field, because the terminal and the prompt use Ctrl+K and Ctrl+\.
 */
export function pageAction(event: PageKeyEvent): WorkbenchAction | null {
  if (event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return null;
  if (!event.metaKey && editable(event.target)) return null;
  if (!Object.hasOwn(WORKBENCH_KEY_CODES, event.code)) return null;
  return KEY_ACTIONS[WORKBENCH_KEY_CODES[event.code as keyof typeof WORKBENCH_KEY_CODES]] ?? null;
}

/**
 * True for ⌘P (Ctrl+P outside a text field) in the page while the scene surface shows: the page sends it to its frame
 * as the bridge call `openPalette`, in place of the print dialog. In the lab frame, the palette of the lab page takes
 * ⌘P itself.
 */
export function paletteKey(event: PageKeyEvent, labShown: boolean): boolean {
  if (!labShown || event.code !== "KeyP" || event.altKey || event.shiftKey) return false;
  if (event.metaKey) return true;
  return event.ctrlKey && !editable(event.target);
}

/** The parts of an element that `focusPrompt` uses (a test gives a fake). */
export interface FocusRoot {
  querySelectorAll(selector: string): Iterable<{ focus(): void; getClientRects(): { readonly length: number } }>;
}

/**
 * Give the focus to the first shown text field of the Claude column: the terminal (xterm reads its keys from a
 * hidden text area) or the prompt of the chat. Returns false when the column has none.
 */
export function focusPrompt(root: FocusRoot | null): boolean {
  if (root === null) return false;
  for (const element of root.querySelectorAll("textarea, input:not([type='hidden']), [contenteditable='true']")) {
    if (element.getClientRects().length === 0) continue;
    element.focus();
    return true;
  }
  return false;
}
