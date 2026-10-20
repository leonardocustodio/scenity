// SPDX-License-Identifier: Apache-2.0
/**
 * The tune values of a page in a result of a command (the lab: tuned numbers of the runtime that live in the URL until
 * `labs tune-apply` writes them into the code). A page with no tune values gives none.
 */
import { cut } from "./kit";

/** The `tune` text of tune values: `path:value,path:value` (room3d-labs `tuneText`). */
export function tuneText(values: Readonly<Record<string, unknown>>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([path, value]) => `${path}:${String(value)}`)
    .join(",");
}

/**
 * The lines of the current tune values. `more` names the tool that gives all values (a page with tune values gives
 * it). The host of that page adds the lines that tell how to write the values into the code.
 */
export function tuneLines(values: Readonly<Record<string, unknown>>, max = 12, more = ""): string[] {
  const entries = Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  if (entries.length === 0) return ["Tunes: none (every tuned number has its default)."];
  return [
    `Tunes not in the code (${String(entries.length)}):`,
    ...cut(entries, max, ([path, value]) => `  ${path} = ${String(value)}`, more),
  ];
}
