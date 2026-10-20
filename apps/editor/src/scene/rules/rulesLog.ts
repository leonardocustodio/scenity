// SPDX-License-Identifier: Apache-2.0
/**
 * The rules log of a scene: the save gate writes each override of a failed block rule into
 * `<folder>/<name>.rules-log.jsonl` next to the scene file (`logOverride` of `@scenity/cli/sceneFile`): the time, the
 * scene, the hash of the saved text, the reason and the failed rules. An override counts only while the file keeps that
 * hash. Pure functions, no DOM.
 */

/** One override of the log. */
export interface LoggedOverride {
  readonly time: string;
  readonly scene: string;
  /** The SHA-256 of the saved text of the scene. */
  readonly hash: string;
  readonly reason: string;
  readonly rules: readonly { readonly id: string; readonly status: string; readonly detail: string }[];
}

/** The path of the log of a scene file (`overrideLogFile` of the writer), relative to the project folder. */
export function rulesLogPath(scenePath: string): string {
  const at = scenePath.lastIndexOf("/");
  const folder = at < 0 ? "" : scenePath.slice(0, at + 1);
  const name = scenePath.slice(at + 1).replace(/\.(scene|sequence)\.json$/, "");
  return `${folder}${name}.rules-log.jsonl`;
}

/** The overrides of a log text, the newest first; a line that does not read is left out. */
export function parseRulesLog(text: string): LoggedOverride[] {
  const out: LoggedOverride[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line) as Partial<LoggedOverride>;
      if (typeof value.hash !== "string" || typeof value.reason !== "string") continue;
      out.push({
        time: typeof value.time === "string" ? value.time : "",
        scene: typeof value.scene === "string" ? value.scene : "",
        hash: value.hash,
        reason: value.reason,
        rules: Array.isArray(value.rules) ? value.rules : [],
      });
    } catch {
      // A line that does not read is not an override.
    }
  }
  return out.reverse();
}
