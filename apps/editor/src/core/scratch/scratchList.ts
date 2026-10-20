// SPDX-License-Identifier: Apache-2.0
/**
 * The scratch props of the lab as text and as places: pure functions, without Vue and without three.js.
 *
 * A scratch prop is the model of an import of the workbench host, placed in the room. It is a lab input, thus the URL
 * names it: `scratch=<import>@x,y,z,turn;<import>@x,y,z,turn` (metres, the turn in degrees). The ID of a scratch prop
 * is its position in the list: `scratch-1`, `scratch-2`, … (a delete moves the IDs after it). The key of a frame holds
 * the text of the list (frameInput.ts `rendererOptions`). Thus the frame index separates the frames with and without
 * scratch props. The page gives the core the places from this text only. Thus a page after a drag and a new page with
 * the same URL draw the same frame.
 */
import type { ScratchPlace } from "@scenity/runtime-dev";
import type { Vec3 } from "@scenity/character";
import type { PropPlace } from "../edit/placeDrag";

/** The URL parameter of the scratch props. */
export const SCRATCH_PARAM = "scratch";
/** The form of an import ID (IMPORT_ID_PATTERN of packages/workbench-host/src/importProtocol.ts). */
export const IMPORT_ID = /^[0-9a-z]{1,12}-[0-9a-f]{8}$/;
/** The most scratch props of a page. */
export const SCRATCH_MAX = 16;
/** The step of a duplicate beside its original (metres, along x). */
export const DUPLICATE_STEP = 0.3;

/** One scratch prop: the import of its model, its base centre (metres) and its turn (degrees). */
export interface ScratchEntry {
  readonly model: string;
  readonly at: Vec3;
  readonly turnDeg: number;
}

const DEG = Math.PI / 180;

/** A position on a 1 mm grid. */
function metres(value: number): number {
  return Math.round(value * 1000) / 1000 || 0;
}

/** A turn in degrees on a 0.01° grid, from -180 (out) to 180 (in). */
function degrees(value: number): number {
  const turned = ((((value + 180) % 360) + 360) % 360) - 180;
  return Math.round(turned * 100) / 100 || 0;
}

/** An entry with its numbers on the grid of the URL text. */
export function entry(model: string, at: readonly number[], turnDeg: number): ScratchEntry {
  return { model, at: [metres(at[0] ?? 0), metres(at[1] ?? 0), metres(at[2] ?? 0)], turnDeg: degrees(turnDeg) };
}

/** The list of the URL text. A part that is not an entry is removed. */
export function parseScratch(text: string | null): ScratchEntry[] {
  if (text === null || text === "") return [];
  const out: ScratchEntry[] = [];
  for (const part of text.split(";")) {
    const match = /^([^@]+)@([^@]+)$/.exec(part.trim());
    const numbers = match?.[2]?.split(",").map(Number) ?? [];
    const model = match?.[1] ?? "";
    if (!IMPORT_ID.test(model) || numbers.length !== 4 || !numbers.every(Number.isFinite)) continue;
    if (numbers.slice(0, 3).some((value) => Math.abs(value) > 50)) continue;
    out.push(entry(model, numbers.slice(0, 3), numbers[3] ?? 0));
    if (out.length === SCRATCH_MAX) break;
  }
  return out;
}

/** The URL text of a list ("" for none). */
export function scratchText(list: readonly ScratchEntry[]): string {
  return list.map((item) => `${item.model}@${[...item.at, item.turnDeg].map(String).join(",")}`).join(";");
}

/** The ID of the scratch prop at an index of the list. */
export function scratchId(index: number): string {
  return `scratch-${String(index + 1)}`;
}

/** The index of a scratch prop ID in a list, or -1. */
export function indexOf(list: readonly ScratchEntry[], id: string): number {
  const match = /^scratch-(\d+)$/.exec(id);
  const index = match === null ? -1 : Number(match[1]) - 1;
  return index >= 0 && index < list.length ? index : -1;
}

/** The place of an entry for the drag (placeDrag.ts): metres and radians. */
export function placeOfEntry(item: ScratchEntry): PropPlace {
  return { at: [item.at[0], item.at[1], item.at[2]], yaw: item.turnDeg * DEG };
}

/** The places of the list for the core. */
export function scratchPlaces(list: readonly ScratchEntry[]): ScratchPlace[] {
  return list.map((item, index) => ({ id: scratchId(index), model: item.model, ...placeOfEntry(item) }));
}

/** The list with one scratch prop at a new place (on the grid of the URL text). */
export function withPlace(list: readonly ScratchEntry[], id: string, place: PropPlace): ScratchEntry[] {
  const index = indexOf(list, id);
  if (index < 0) return [...list];
  const next = [...list];
  next[index] = entry(list[index]?.model ?? "", place.at, place.yaw / DEG);
  return next;
}

/** The list with a new scratch prop of a model at a point (turn 0); a full list stays. */
export function withAdded(list: readonly ScratchEntry[], model: string, at: Vec3): ScratchEntry[] {
  return list.length >= SCRATCH_MAX ? [...list] : [...list, entry(model, at, 0)];
}

/** The list with a copy of a scratch prop, DUPLICATE_STEP to its side. */
export function withDuplicate(list: readonly ScratchEntry[], id: string): ScratchEntry[] {
  const item = list[indexOf(list, id)];
  if (item === undefined || list.length >= SCRATCH_MAX) return [...list];
  return [...list, entry(item.model, [item.at[0] + DUPLICATE_STEP, item.at[1], item.at[2]], item.turnDeg)];
}

/** The list without a scratch prop. */
export function without(list: readonly ScratchEntry[], id: string): ScratchEntry[] {
  const index = indexOf(list, id);
  return index < 0 ? [...list] : list.filter((_, at) => at !== index);
}

/** The import IDs of a list, each once, in the order of the list. */
export function modelsOf(list: readonly ScratchEntry[]): string[] {
  return [...new Set(list.map((item) => item.model))];
}
