// SPDX-License-Identifier: Apache-2.0
/**
 * The console of the dev scene worker for the page: each `console.error` and `console.warn` of the worker, each
 * uncaught error and each unhandled rejection goes to the page as an extension message `workerLog`, so the Console
 * panel shows it with the source "worker". The worker console keeps its own output.
 */
import type { ExtensionMessage } from "@scenity/runtime/protocol";

/** The longest text of one message (characters). */
const TEXT_LIMIT = 4000;

/** A line of the console of the worker. */
export interface WorkerLogMessage extends ExtensionMessage {
  readonly type: "workerLog";
  readonly level: "error" | "warn";
  readonly text: string;
}

/** The parts of the worker scope that the tap uses. */
export interface WorkerLogScope {
  readonly console: Pick<Console, "error" | "warn">;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

/** One value of a console call as text. */
function textOf(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    // JSON.stringify gives undefined for a function or undefined.
    const text = JSON.stringify(value) as string | undefined;
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

/** True for a `workerLog` message of the worker. */
export function isWorkerLog(message: ExtensionMessage): message is WorkerLogMessage {
  return message.type === "workerLog";
}

/** Send the console lines and the uncaught errors of a worker scope to the page. */
export function tapWorkerConsole(scope: WorkerLogScope, post: (message: WorkerLogMessage) => void): void {
  const send = (level: WorkerLogMessage["level"], values: readonly unknown[]): void => {
    const text = values.map(textOf).join(" ");
    post({ type: "workerLog", level, text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text });
  };
  for (const level of ["error", "warn"] as const) {
    const original = scope.console[level].bind(scope.console);
    scope.console[level] = (...values: unknown[]) => {
      send(level, values);
      original(...values);
    };
  }
  scope.addEventListener("error", (event) => {
    const item = event as ErrorEvent;
    send("error", [item.error instanceof Error ? item.error : item.message]);
  });
  scope.addEventListener("unhandledrejection", (event) => {
    send("error", ["unhandled rejection:", (event as PromiseRejectionEvent).reason]);
  });
}
