// SPDX-License-Identifier: Apache-2.0
/**
 * The terminal messages of the workbench protocol. `protocol.ts` exports them. This module is pure types, so the
 * page gets them through `@scenity/workbench-host/protocol`.
 *
 * `terminal.output` gives the bytes of the PTY as UTF-8 text, without a change (the CLI draws with 24-bit color).
 */

/** The kinds of terminal: the `claude` CLI or the login shell of the owner (`$SHELL -il`). */
export type TerminalKind = "claude" | "shell";

/** The parameters of `terminal.open`. */
export interface TerminalOpenParams {
  readonly kind: TerminalKind;
  readonly cols: number;
  readonly rows: number;
  /**
   * The ID of a terminal of the same kind: the host opens it again and gives its scrollback (a reload of the page).
   * The host starts a new terminal for an unknown ID.
   */
  readonly terminal?: string;
  /** The kind `claude` only: the CLI starts with `--resume <id>`. */
  readonly resume?: string;
  /** The kind `claude` only: keep `ANTHROPIC_API_KEY` in its environment. The default removes it. */
  readonly apiKey?: boolean;
}

/** The end of the process of a terminal: its exit code, or the signal that ended it. */
export interface TerminalExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** The result of `terminal.open`. */
export interface TerminalOpened {
  readonly terminal: string;
  readonly kind: TerminalKind;
  /** The working folder of the terminal: the checkout that was open at its start. */
  readonly checkout: string;
  /** True when the host opened a terminal that it knew (a reload of the page). */
  readonly attached: boolean;
  /** The scrollback of the terminal, empty for a new terminal. */
  readonly replay: string;
  /** The end of the process, or null while it runs. */
  readonly exit: TerminalExit | null;
}
