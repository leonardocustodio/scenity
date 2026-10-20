// SPDX-License-Identifier: Apache-2.0
/**
 * The usage log of a usability study. By default, there is no usage data. The person can enable Preferences → Usage
 * log (`usage.log`, a setting of this browser). Then the editor keeps a line for each command that runs in the browser
 * storage (`scenity.usage.log`, the last 2,000 lines). A line has the command ID, its source (a key, a menu or a call)
 * and the time. The log never leaves the machine, because the page does not send it. The person downloads it as a
 * file for the study, or clears it.
 */

/** One line of the log. */
export interface UsageLine {
  /** The time in ms since 1970. */
  readonly at: number;
  readonly command: string;
  readonly how: "key" | "menu" | "call";
}

export const USAGE_KEY = "scenity.usage.log";
/** The most lines of the log. */
export const USAGE_MAX = 2000;

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The lines of the log, the oldest first. */
export function usageLines(): UsageLine[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(USAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as UsageLine[]) : [];
  } catch {
    return [];
  }
}

/** Add a line when the log is enabled. */
export function recordUsage(on: boolean, line: UsageLine): void {
  if (!on) return;
  try {
    storage()?.setItem(USAGE_KEY, JSON.stringify([...usageLines(), line].slice(-USAGE_MAX)));
  } catch {
    // A full or blocked storage keeps no line.
  }
}

/** Clear the log. */
export function clearUsage(): void {
  try {
    storage()?.removeItem(USAGE_KEY);
  } catch {
    // A blocked storage has no log.
  }
}

/** The log as a file of JSON lines, for a download. */
export function usageFile(): string {
  return usageLines()
    .map((line) => JSON.stringify(line))
    .join("\n");
}
