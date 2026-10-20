// SPDX-License-Identifier: Apache-2.0
/**
 * The generic rows of the context packet: the entities on screen, from the inspect report
 * of a scene page (`entities` of the report of `@scenity/runtime-dev`). The host shows them when no host
 * plugin gives the rows of its scene (`contextLines.members`), so a scene project gets rows too.
 */
import { list, record, text } from "./tools/kit";

/** The first three components of an entity in one cell, then `…` when it has more. */
function componentsText(value: unknown): string {
  const names = list(value).flatMap((item) => (typeof item === "string" ? [item] : []));
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown}, …` : shown;
}

/** The entities on screen, two per line: `cart  (model, obstacle, socket, …)`. */
export function entityRows(report: unknown, maxRows = 4): string[] {
  const entities = list(record(report).entities)
    .map(record)
    .filter((entity) => entity.visible !== false);
  if (entities.length === 0) return ["  no entities"];
  const cells = entities.map((entity) => {
    const id = (text(entity.id) ?? "?").padEnd(14);
    return `${id} ${`(${componentsText(entity.components)})`.padEnd(34)}`;
  });
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(`  ${cells.slice(index, index + 2).join(" ")}`.trimEnd());
  }
  const shown = rows.slice(0, maxRows);
  if (rows.length > maxRows) shown.push(`  … and ${String(entities.length - maxRows * 2)} more entities`);
  return shown;
}
