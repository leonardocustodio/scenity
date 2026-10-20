// SPDX-License-Identifier: Apache-2.0
/**
 * The console of the lab page for the workbench bridge. The log keeps the errors and the warnings until the next
 * `take`. They come from `console.error`, `console.warn`, the window `error` event and unhandled promise rejections.
 * When the Vite error overlay shows, its text goes with the errors.
 */

/** The maximum number of entries of each kind that the log keeps between two calls. The oldest entries go first. */
const KEEP = 200;
/** The longest text of one entry (characters). */
const TEXT_LIMIT = 2_000;

export interface ConsoleEntries {
  readonly errors: string[];
  readonly warnings: string[];
}

export interface ConsoleLog {
  /** The errors and the warnings since the last call, and the text of the Vite error overlay. */
  take(): ConsoleEntries;
  /** Restore the console methods and remove the listeners. */
  stop(): void;
}

/** The window parts that the log uses (a test gives a fake). */
export interface ConsoleHost {
  readonly console: Pick<Console, "error" | "warn">;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  readonly document?: Pick<Document, "querySelector">;
}

function clip(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
}

/** One value of a console call as text. */
export function consoleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : String(value);
  } catch {
    return String(value);
  }
}

/** The text of the Vite error overlay, or null when no overlay shows. */
export function overlayText(document: Pick<Document, "querySelector"> | undefined): string | null {
  const overlay = document?.querySelector("vite-error-overlay");
  if (overlay === null || overlay === undefined) return null;
  const root = overlay.shadowRoot ?? overlay;
  const parts = [".message", ".file"]
    .map((selector) => root.querySelector(selector)?.textContent.trim() ?? "")
    .filter((text) => text !== "");
  const text = parts.length > 0 ? parts.join("\n") : root.textContent.trim();
  return text === "" ? null : clip(`vite error overlay: ${text}`);
}

function push(list: string[], text: string): void {
  list.push(clip(text));
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
}

/**
 * Start the log. `onError` gets each new error (the bridge sends a `console` event); it must not write to the console.
 */
export function captureConsole(host: ConsoleHost, onError: (text: string) => void): ConsoleLog {
  let errors: string[] = [];
  let warnings: string[] = [];
  const original = { error: host.console.error, warn: host.console.warn };

  function addError(text: string): void {
    push(errors, text);
    onError(clip(text));
  }
  const error = (...args: unknown[]): void => {
    addError(args.map(consoleText).join(" "));
    original.error.apply(host.console, args);
  };
  const warn = (...args: unknown[]): void => {
    push(warnings, args.map(consoleText).join(" "));
    original.warn.apply(host.console, args);
  };
  const onWindowError = (event: Event): void => {
    const item = event as ErrorEvent;
    const where =
      typeof item.filename === "string" && item.filename !== ""
        ? ` (${item.filename}:${String(item.lineno)}:${String(item.colno)})`
        : "";
    addError(item.error instanceof Error ? consoleText(item.error) : `${item.message}${where}`);
  };
  const onRejection = (event: Event): void => {
    addError(`unhandled rejection: ${consoleText((event as PromiseRejectionEvent).reason)}`);
  };
  host.console.error = error;
  host.console.warn = warn;
  host.addEventListener("error", onWindowError);
  host.addEventListener("unhandledrejection", onRejection);

  return {
    take() {
      const overlay = overlayText(host.document);
      const out = { errors: overlay === null ? errors : [...errors, overlay], warnings };
      errors = [];
      warnings = [];
      return out;
    },
    stop() {
      if (host.console.error === error) host.console.error = original.error;
      if (host.console.warn === warn) host.console.warn = original.warn;
      host.removeEventListener("error", onWindowError);
      host.removeEventListener("unhandledrejection", onRejection);
    },
  };
}
