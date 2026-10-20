// SPDX-License-Identifier: Apache-2.0
/**
 * The xterm.js screen of the Terminal panel: xterm.js 6 with the fit addon and the DOM
 * renderer (the Scene view owns the GPU). The colours come from the tokens of the page.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/** The token variables of the screen colours. */
const COLORS = {
  background: "--sc-color-surface-sunken",
  foreground: "--sc-color-text-primary",
  cursor: "--sc-color-focus-ring",
  cursorAccent: "--sc-color-surface-sunken",
  selectionBackground: "--sc-color-status-info-subtle",
  red: "--sc-color-status-negative",
  green: "--sc-color-status-positive",
  yellow: "--sc-color-status-caution",
  blue: "--sc-color-status-info",
  magenta: "--sc-color-status-attention",
  cyan: "--sc-color-accent-text",
  white: "--sc-color-text-primary",
  brightBlack: "--sc-color-text-secondary",
} as const;

/** The screen colours from the token variables of an element. */
export function themeFrom(element: Element): ITheme {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    Object.entries(COLORS).map(([name, variable]) => [name, style.getPropertyValue(variable).trim()]),
  );
}

/** A screen with the fit addon and the token colours. */
export function makeXterm(): { readonly term: Terminal; fit(): void } {
  const root = document.documentElement;
  const term = new Terminal({
    cursorBlink: false,
    fontFamily: getComputedStyle(root).getPropertyValue("--sc-font-family-mono").trim() || "monospace",
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: themeFrom(root),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  return { term, fit: () => fitAddon.fit() };
}
