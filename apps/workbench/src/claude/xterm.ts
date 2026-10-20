// SPDX-License-Identifier: Apache-2.0
/**
 * The xterm.js screen of the Claude panel: xterm.js 6 with the fit addon and the default
 * DOM renderer (no WebGL: the lab in the frame owns the GPU). The colors come from the design tokens of the page
 * (the navy theme of index.html), so the screen has the dark look of the workbench.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { XtermKit } from "./useTerminal";

/** The token variables of the screen colors, with a fallback for a page without the tokens. */
const COLORS = {
  background: ["--sc-color-surface-sunken", "#071423"],
  foreground: ["--sc-color-text-primary", "#e7edf3"],
  cursor: ["--sc-color-focus-ring", "#fde68a"],
  cursorAccent: ["--sc-color-surface-sunken", "#071423"],
  selectionBackground: ["--sc-color-status-info-subtle", "#1f344f"],
  black: ["--sc-color-surface-device", "#040e19"],
  red: ["--sc-color-status-negative", "#ff7474"],
  green: ["--sc-color-status-positive", "#34d399"],
  yellow: ["--sc-color-status-caution", "#fbbf24"],
  blue: ["--sc-color-status-info", "#5fb0ff"],
  magenta: ["--sc-color-status-attention", "#fb923c"],
  cyan: ["--sc-color-accent-text", "#7fb2f0"],
  white: ["--sc-color-text-primary", "#e7edf3"],
  brightBlack: ["--sc-color-text-secondary", "#93a6c0"],
} as const satisfies Record<string, readonly [string, string]>;

/** The screen colors from the token variables of an element. */
export function themeFrom(element: Element): ITheme {
  const style = getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const [name, [variable, fallback]] of Object.entries(COLORS)) {
    theme[name] = style.getPropertyValue(variable).trim() || fallback;
  }
  return theme;
}

function monoFont(element: Element): string {
  return getComputedStyle(element).getPropertyValue("--sc-font-family-mono").trim() || "Menlo, monospace";
}

/**
 * The cursor blinks only while the screen has the focus. A blink of a screen without the focus draws the page again
 * twice a second for no result. The textarea of xterm.js has the focus of the screen. It exists after `open`.
 */
export function blinkWithFocus(term: Pick<Terminal, "options" | "textarea">): void {
  const textarea = term.textarea;
  if (textarea === undefined) return;
  term.options.cursorBlink = textarea.ownerDocument.activeElement === textarea;
  textarea.addEventListener("focus", () => {
    term.options.cursorBlink = true;
  });
  textarea.addEventListener("blur", () => {
    term.options.cursorBlink = false;
  });
}

/** Make a screen with the fit addon and the token colors. */
export function makeXterm(): XtermKit {
  const root = document.documentElement;
  const term = new Terminal({
    allowProposedApi: false,
    // No blink until the screen has the focus (blinkWithFocus).
    cursorBlink: false,
    fontFamily: monoFont(root),
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: themeFrom(root),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const open = term.open.bind(term);
  term.open = (parent: HTMLElement): void => {
    open(parent);
    blinkWithFocus(term);
  };
  return {
    term,
    // A hidden element (display: none) has no size: the addon then keeps the size of the screen.
    fit: () => fitAddon.fit(),
  };
}
