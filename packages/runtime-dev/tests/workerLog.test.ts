// SPDX-License-Identifier: Apache-2.0
// The console of the dev scene worker for the page: each error and warning of the worker console and each uncaught
// error goes to the page as a `workerLog` message, and the worker console keeps its output.
import { describe, expect, test } from "bun:test";
import { isWorkerLog, tapWorkerConsole, type WorkerLogMessage } from "../src/document/workerLog";

describe("the console of the dev scene worker", () => {
  test("sends the errors, the warnings and the uncaught errors to the page", () => {
    const written: unknown[][] = [];
    const listeners = new Map<string, (event: Event) => void>();
    const scope = {
      console: {
        error: (...values: unknown[]) => written.push(values),
        warn: (...values: unknown[]) => written.push(values),
      },
      addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
    };
    const sent: WorkerLogMessage[] = [];
    tapWorkerConsole(scope, (message) => sent.push(message));
    scope.console.error("the system failed", { step: 3 });
    scope.console.warn("slow");
    listeners.get("error")?.({ error: new Error("uncaught"), message: "uncaught" } as unknown as Event);
    listeners.get("unhandledrejection")?.({ reason: "lost" } as unknown as Event);
    expect(written).toHaveLength(2);
    expect(sent.map((message) => [message.level, message.text.split("\n")[0]])).toEqual([
      ["error", 'the system failed {"step":3}'],
      ["warn", "slow"],
      ["error", "Error: uncaught"],
      ["error", "unhandled rejection: lost"],
    ]);
    expect(sent.every(isWorkerLog)).toBe(true);
    expect(isWorkerLog({ type: "sceneInspected" })).toBe(false);
  });
});
