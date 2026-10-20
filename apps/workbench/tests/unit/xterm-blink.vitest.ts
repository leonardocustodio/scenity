// SPDX-License-Identifier: Apache-2.0
/**
 * The cursor of the terminal blinks only while the screen has the focus. The focus of the textarea of xterm.js starts
 * the blink, and the blur stops it.
 */
import { describe, expect, test } from "vitest";
import { blinkWithFocus } from "../../src/claude/xterm";

describe("the blink of the terminal cursor", () => {
  test("blinks with the focus of the screen only", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    const term = { options: { cursorBlink: true }, textarea };
    blinkWithFocus(term);
    expect(term.options.cursorBlink).toBe(false);
    textarea.focus();
    expect(term.options.cursorBlink).toBe(true);
    textarea.blur();
    expect(term.options.cursorBlink).toBe(false);
    textarea.remove();
  });

  test("does nothing before the screen opens (no textarea)", () => {
    const term = { options: { cursorBlink: false }, textarea: undefined };
    blinkWithFocus(term);
    expect(term.options.cursorBlink).toBe(false);
  });
});
