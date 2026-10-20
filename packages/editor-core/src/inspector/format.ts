// SPDX-License-Identifier: Apache-2.0
/**
 * The value helpers of the inspector widgets: numbers with limits, the drag of a number, colours, a quaternion as Euler
 * angles in degrees, references, curves and JSON text. Pure functions. No Vue import, no DOM.
 */
import { eulerFromQuat, quatFromEuler, type Quat, type Vec3 } from "@scenity/scene/math";
import { parseRef } from "@scenity/scene/refs";
import type { NumberLimits, WidgetModel } from "./widgets";

/** The grid of the numbers that the inspector writes (the grid of the canonical writer). */
const GRID = 1e6;

function onGrid(value: number): number {
  const rounded = Math.round(value * GRID) / GRID;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** A number in the limits: clamped, and rounded for an integer field. */
export function limitNumber(value: number, limits: Partial<NumberLimits>): number {
  const clamped = Math.min(limits.max ?? Infinity, Math.max(limits.min ?? -Infinity, value));
  return limits.integer === true ? Math.round(clamped) : onGrid(clamped);
}

/** The number of a text in the limits, or null when the text is no number. */
export function parseNumber(text: string, limits: Partial<NumberLimits>): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : limitNumber(value, limits);
}

/** The text of a number for a field: at most 6 decimals, and no zeros at the end. */
export function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(onGrid(value)) : "";
}

/**
 * The number after a drag of `pixels` (right is more) from `start`: one step for each 4 pixels. Shift gives ten
 * steps, and Alt gives a tenth of a step.
 */
export function dragNumber(
  start: number,
  pixels: number,
  limits: Partial<NumberLimits>,
  keys: { readonly shift?: boolean; readonly alt?: boolean } = {},
): number {
  const step = (limits.step ?? 0.01) * (keys.shift === true ? 10 : 1) * (keys.alt === true ? 0.1 : 1);
  const steps = Math.trunc(pixels / 4);
  const raw = start + steps * step;
  return limitNumber(Math.round(raw / step) * step, limits);
}

function hexPart(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

/** The `#rrggbb` text of a colour value (`#rrggbb` or `[r, g, b]`). "#000000" for another value. */
export function colourHex(value: unknown): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number")) {
    return `#${value.map((part: number) => hexPart(part)).join("")}`;
  }
  return "#000000";
}

/** The colour value of a `#rrggbb` text in the form of the value before (an `[r, g, b]` value stays a list). */
export function colourValue(hex: string, before: unknown): string | [number, number, number] {
  const text = hex.toLowerCase();
  if (!Array.isArray(before)) return text;
  return [1, 3, 5].map((start) => parseInt(text.slice(start, start + 2), 16)) as [number, number, number];
}

/** The Euler angles in degrees (order XYZ, 0.01° grid) of a quaternion value. Zeros for another value. */
export function eulerDegrees(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, 0];
  return eulerFromQuat(value as Quat).map((angle) => Math.round(angle * 100) / 100) as Vec3;
}

/** The quaternion of Euler angles in degrees (order XYZ), on the grid of the writer. */
export function quaternionOf(degrees: Vec3): Quat {
  return quatFromEuler(degrees).map(onGrid) as Quat;
}

/** The entity ID and the sub-target of an entity reference text, or null. */
export function entityRefParts(text: unknown): { id: string; sub?: string } | null {
  if (typeof text !== "string") return null;
  const ref = parseRef(text);
  if (ref?.kind !== "entity") return null;
  return ref.sub === undefined ? { id: ref.id } : { id: ref.id, sub: ref.sub };
}

/** The asset ID of an asset reference text, or null. */
export function assetRefId(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const ref = parseRef(text);
  return ref?.kind === "asset" ? ref.id : null;
}

/** The JSON text of a value for the JSON widget. */
export function jsonText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

/** The value of a JSON text, or an error text. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

type CurveWidget = Extract<WidgetModel, { kind: "curve" }>;

/** The 2D points of a curve value: (time, value) of each key, or (x, z) of each point (x, y for 2D points). */
export function curvePoints(widget: CurveWidget, value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (widget.form === "keys") {
    return value
      .map((key) => key as Record<string, unknown>)
      .map((key): [number, number] => [Number(key[widget.time] ?? 0), Number(key[widget.value] ?? 0)]);
  }
  const axis = widget.size >= 3 ? 2 : 1;
  return value.map((point): [number, number] => {
    const parts = Array.isArray(point) ? (point as number[]) : [];
    return [parts[0] ?? 0, parts[axis] ?? 0];
  });
}

/** The SVG polyline text of a curve in a box of `width` × `height` (the points fill the box; y goes up). */
export function curvePolyline(points: readonly [number, number][], width: number, height: number): string {
  if (points.length === 0) return "";
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = x1 === x0 ? 0 : (width - 8) / (x1 - x0);
  const sy = y1 === y0 ? 0 : (height - 8) / (y1 - y0);
  return points
    .map(([x, y]) => {
      const px = x1 === x0 ? width / 2 : 4 + (x - x0) * sx;
      const py = y1 === y0 ? height / 2 : height - 4 - (y - y0) * sy;
      return `${String(Math.round(px * 10) / 10)},${String(Math.round(py * 10) / 10)}`;
    })
    .join(" ");
}

/** A curve with one more item at the end: the last key one second later, or the last point one metre along x. */
export function addCurveItem(widget: CurveWidget, value: unknown): unknown[] {
  const list = Array.isArray(value) ? [...(value as unknown[])] : [];
  const last = list.at(-1);
  if (widget.form === "keys") {
    const key = (last ?? {}) as Record<string, unknown>;
    const time = Number(key[widget.time] ?? -1000) + 1000;
    list.push({ ...key, [widget.time]: time, [widget.value]: Number(key[widget.value] ?? 0) });
    return list;
  }
  const point = Array.isArray(last) ? [...(last as number[])] : Array.from({ length: widget.size }, () => 0);
  point[0] = (point[0] ?? 0) + 1;
  list.push(point);
  return list;
}

/** A list with the item at `index` taken out. */
export function removeItem(value: unknown, index: number): unknown[] {
  const list = Array.isArray(value) ? [...(value as unknown[])] : [];
  list.splice(index, 1);
  return list;
}

/** The keys of a curve in the order of their times (a key edit can change the order). */
export function sortKeys(widget: CurveWidget, value: unknown): unknown {
  if (widget.form !== "keys" || !Array.isArray(value)) return value;
  const time = (key: unknown) => Number((key as Record<string, unknown>)[widget.time] ?? 0);
  return [...(value as unknown[])].sort((a, b) => time(a) - time(b));
}

/** True when a value has the form of a widget (the forms of a choice widget). */
export function fitsWidget(widget: WidgetModel, value: unknown): boolean {
  const numbers = (size?: number) =>
    Array.isArray(value) &&
    value.every((part) => typeof part === "number") &&
    (size === undefined || value.length === size);
  const text = (prefix: string) => typeof value === "string" && value.startsWith(prefix);
  switch (widget.kind) {
    case "number":
      return typeof value === "number";
    case "vector":
      return numbers(widget.size);
    case "quaternion":
      return numbers(4);
    case "colour":
      return text("#") || numbers(3);
    case "enum":
      return typeof value === "string" && widget.options.includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "assetRef":
      return text("asset:");
    case "entityRef":
      return text("entity:");
    case "curve":
    case "list":
      return Array.isArray(value);
    case "map":
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "choice":
      return widget.options.some((option) => fitsWidget(option, value));
    case "json":
      return true;
  }
}

/** The index of the form of a choice widget that the value has. 0 when no form fits. */
export function choiceIndex(widget: Extract<WidgetModel, { kind: "choice" }>, value: unknown): number {
  const found = widget.options.findIndex((option) => fitsWidget(option, value));
  return found < 0 ? 0 : found;
}

/** A short name of a form of a choice widget: the one option of a field of an object, else the widget kind. */
export function formLabel(widget: WidgetModel): string {
  if (widget.kind === "object") {
    const tag = widget.fields.find((field) => field.widget.kind === "enum" && field.widget.options.length === 1);
    if (tag?.widget.kind === "enum" && tag.widget.options[0] !== undefined) return tag.widget.options[0];
    return "Object";
  }
  const names: Partial<Record<WidgetModel["kind"], string>> = {
    vector: "Point",
    entityRef: "Entity",
    assetRef: "Asset",
    colour: "Colour",
    number: "Number",
    string: "Text",
    boolean: "Switch",
    list: "List",
    map: "Map",
    curve: "Curve",
  };
  return names[widget.kind] ?? widget.kind;
}
