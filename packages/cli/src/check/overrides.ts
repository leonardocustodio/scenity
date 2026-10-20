// SPDX-License-Identifier: Apache-2.0
/**
 * The known overrides of `scenity check`. The writer of the scene files (sceneFile/ruleGate.ts) keeps the reason of
 * each override in `<scene>.rules-log.jsonl` next to the scene file, with the hash of the saved text and the
 * failed `block` rules.
 *
 * The rule: a line of the log accepts a failed `block` rule of a scene when the line names the rule and its hash is
 * the SHA-256 of the current scene file. A change of the scene file after the override makes the override stale, so the
 * rule fails again. A rule of a sequence uses the log of the scene that the sequence animates.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { overrideLogFile } from "../sceneFile/ruleGate";

/** One override of the log that the check reads. */
export interface LoggedOverride {
  readonly hash: string;
  readonly reason: string;
  readonly rules: readonly string[];
}

/** The parsed lines of the override log of a scene file; a line that does not read gives no override. */
export function readOverrideLog(dir: string, scenePath: string): LoggedOverride[] {
  const file = overrideLogFile(join(dir, ...scenePath.split("/")));
  if (!existsSync(file)) return [];
  const out: LoggedOverride[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line) as { hash?: unknown; reason?: unknown; rules?: unknown };
      if (typeof value.hash !== "string" || typeof value.reason !== "string" || !Array.isArray(value.rules)) continue;
      const rules = value.rules.flatMap((rule: unknown) => {
        const id = (rule as { id?: unknown } | null)?.id;
        return typeof id === "string" ? [id] : [];
      });
      out.push({ hash: value.hash, reason: value.reason, rules });
    } catch {
      // A line that is not JSON accepts nothing.
    }
  }
  return out;
}

/** The reason of the newest override of the log that accepts the rule for the current scene file hash, or null. */
export function acceptedOverride(log: readonly LoggedOverride[], hash: string, rule: string): string | null {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const line = log[index];
    if (line?.hash === hash && line.rules.includes(rule)) return line.reason;
  }
  return null;
}
