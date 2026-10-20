// SPDX-License-Identifier: Apache-2.0
/**
 * The picked item of the lab: the facts that the lab gives (`picked`, `pick`) and the files behind the item.
 * `lab_pick` and the "picked" block of the context packet use them. A host plugin gives the files of an item
 * (`paths.picked` of plugin.ts). Without a plugin, the block has the facts only.
 */
import { pluginPaths } from "../plugins";
import { list, number, record, text } from "./kit";

/** A picked item: its kind and ID, as the lab gives them (`picked`, `pick`). */
export interface PickedTarget {
  readonly kind: string;
  readonly id: string;
}

/** The lines of the files of a picked item from the plugins, or none. */
export function pickedFileLines(checkout: string, target: PickedTarget): string[] {
  return pluginPaths().picked?.(checkout, target) ?? [];
}

/** The lines of a picked item that the lab gives (`picked` of the lab API), without the files. */
export function pickedFactLines(value: unknown): string[] {
  const item = record(value);
  const kind = text(item.kind);
  const id = text(item.id);
  if (kind === null || id === null) return [];
  const bone = text(item.bone);
  const lines = [`Picked: ${kind} ${id}${bone === null ? "" : `, bone ${bone}`}`];
  const asset = record(item.asset);
  if (text(asset.id) !== null) lines.push(`  asset: ${text(asset.id) ?? ""} (${text(asset.file) ?? "?"})`);
  const place = record(item.place);
  const x = number(place.x);
  if (x !== null) {
    const yaw = number(place.yawDeg) ?? 0;
    lines.push(
      `  place: x ${String(x)}, y ${String(number(place.y) ?? 0)}, z ${String(number(place.z) ?? 0)}, turn ${String(yaw)}°`,
    );
  }
  const point = list(item.point).map((value) => number(value) ?? 0);
  if (point.length === 3) lines.push(`  hit point: ${point.join(", ")}`);
  const near = list(item.near).map(record);
  if (near.length > 0) {
    lines.push(
      `  near: ${near.map((entry) => `${text(entry.name) ?? "?"} (${String(number(entry.cm) ?? 0)} cm)`).join(", ")}`,
    );
  }
  for (const warning of list(item.warnings)) if (typeof warning === "string") lines.push(`  warning: ${warning}`);
  const scratch = record(item.scratch);
  const importId = text(scratch.import);
  if (importId !== null) {
    // The import of a scratch prop, the rights answers of the owner and the gap of the licence register.
    const gap = text(scratch.rightsGap);
    lines.push(
      `  import ${importId} (${text(scratch.name) ?? "?"}): source "${text(scratch.source) ?? ""}", licence "${text(scratch.licence) ?? ""}"${gap === null ? "" : ` — rights not allowed: ${gap}`}`,
    );
  }
  return lines;
}

/** The "picked" block: the facts of the lab and the files of the checkout. Empty without a picked item. */
export function pickedBlock(checkout: string, value: unknown): string[] {
  const facts = pickedFactLines(value);
  if (facts.length === 0) return [];
  const item = record(value);
  const files = pickedFileLines(checkout, { kind: text(item.kind) ?? "", id: text(item.id) ?? "" });
  // The first line of the files repeats the item: only its details go into the block.
  return [
    ...facts,
    ...files
      .slice(files[0]?.endsWith(":") === true ? 1 : 0)
      .map((line) => (line.startsWith("  ") ? line : `  ${line}`)),
  ];
}
