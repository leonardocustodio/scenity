// SPDX-License-Identifier: Apache-2.0
/**
 * The measure tool of the scene editor: the distance between two points of the room in centimetres, with its
 * horizontal part (on the floor plane) and its vertical part. The points come from two picks on the scene, or from two
 * points that a command gives (`x,y,z` in metres). They can also come from two items: a prop (its place), a member (its
 * stand place, or a joint), a work point of the room kit, or a named end of the plugin
 * (`EditorPlugin.placement.measureEnds`, a name for a work point).
 *
 * A measurement is a readout of the lab. It is not an input of a frame, and it is not in the URL or `frameKey`. It
 * goes into the context packet of the workbench. No Vue import: the tests and the tools read it.
 */
import type { Vec3 } from "@scenity/character";
import type { InspectReport } from "../../plugins";
import { placeOf } from "../edit/placeDrag";
import { editorPlugin } from "../plugin";
import { t } from "../../texts";

/** One end of a measurement: the point in the room (metres) and what it is (`prop:cart`, `point`, …). */
export interface MeasureEnd {
  readonly at: Vec3;
  readonly what: string;
}

export interface Measurement {
  /** `m1`, `m2`, … in the order of the page. */
  readonly id: string;
  readonly from: MeasureEnd;
  readonly to: MeasureEnd;
  /** The distance (cm, step 0.1 cm), its part on the floor plane, and its vertical part (cm, + when `to` is higher). */
  readonly cm: number;
  readonly horizontalCm: number;
  readonly verticalCm: number;
}

const tenth = (metres: number): number => Math.round(metres * 1000) / 10;
const roundPoint = (point: Vec3): Vec3 => point.map((value) => Math.round(value * 1e4) / 1e4) as unknown as Vec3;

/** The measurement between two points. */
export function measureBetween(id: string, from: MeasureEnd, to: MeasureEnd): Measurement {
  const [dx, dy, dz] = [to.at[0] - from.at[0], to.at[1] - from.at[1], to.at[2] - from.at[2]];
  return {
    id,
    from: { at: roundPoint(from.at), what: from.what },
    to: { at: roundPoint(to.at), what: to.what },
    cm: tenth(Math.hypot(dx, dy, dz)),
    horizontalCm: tenth(Math.hypot(dx, dz)),
    verticalCm: tenth(dy),
  };
}

/** The words of a measurement: `m1: 123.4 cm (horizontal 120.0, vertical +25.3) from … to …`. */
export function measureText(measurement: Measurement): string {
  const { cm, horizontalCm, verticalCm } = measurement;
  const sign = verticalCm > 0 ? "+" : "";
  const end = (item: MeasureEnd): string => t("commands-measure-end", { what: item.what, at: item.at.join(", ") });
  return t("commands-measure-text", {
    id: measurement.id,
    cm: cm.toFixed(1),
    horizontal: horizontalCm.toFixed(1),
    vertical: `${sign}${verticalCm.toFixed(1)}`,
    from: end(measurement.from),
    to: end(measurement.to),
  });
}

/** The label of a measurement in the frame. `named` puts the ID of the measurement first. */
export function measureLabel(measurement: Measurement, named = false): string {
  return t(named ? "commands-measure-label-named" : "commands-measure-label", {
    id: measurement.id,
    cm: measurement.cm.toFixed(1),
    horizontal: measurement.horizontalCm.toFixed(1),
    vertical: Math.abs(measurement.verticalCm).toFixed(1),
  });
}

/** What the ends of a command read: the tune values and their defaults, and the inspect report of the last frame. */
export interface MeasureFacts {
  readonly tunes: Readonly<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  readonly report: InspectReport | null;
}

/** A point text `x,y,z` (metres), or null. */
function pointText(text: string): Vec3 | null {
  const parts = text.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** The words of the forms of an end, for an error (with the named ends of the plugin). */
export function endForms(): string {
  const named = Object.entries(editorPlugin().placement.measureEnds).map(([name, point]) =>
    t("commands-measure-named-end", { name, point }),
  );
  return named.length === 0
    ? t("commands-measure-forms")
    : t("commands-measure-forms-named", { named: named.join(", ") });
}

/** The member of the report and its point: the stand place, or a joint. */
function memberEnd(text: string, report: InspectReport | null): Vec3 {
  const [id = "", joint] = text.slice("member:".length).split(".");
  const member = report?.members.find((item) => item.id === id);
  if (member === undefined) {
    const ids = report?.members.map((item) => item.id).join(", ") ?? t("commands-measure-no-members");
    throw new Error(t("commands-measure-no-member", { id, ids }));
  }
  if (joint === undefined) return [member.at[0], 0, member.at[1]];
  const at = (member.joints as Readonly<Record<string, Vec3 | undefined>>)[joint];
  if (at === undefined)
    throw new Error(t("commands-measure-no-joint", { joint, id, joints: Object.keys(member.joints).join(", ") }));
  return at;
}

/** The point of an end of `measure.between`. Throws with the forms for a text that is none of them. */
export function resolveEnd(text: string, facts: MeasureFacts): MeasureEnd {
  const trimmed = text.trim();
  const point = pointText(trimmed);
  if (point !== null) return { at: point, what: "point" };
  if (trimmed.startsWith("prop:")) {
    const slot = trimmed.slice("prop:".length);
    const place = placeOf(slot, facts.tunes, facts.defaults);
    if (place === null) throw new Error(t("commands-measure-no-prop", { slot }));
    return { at: place.at, what: trimmed };
  }
  if (trimmed.startsWith("member:")) return { at: memberEnd(trimmed, facts.report), what: trimmed };
  // A named end of the plugin is the name of a work point (`name` or `name:name`).
  const ends = editorPlugin().placement.measureEnds;
  const [head = "", tail] = trimmed.split(":");
  const alias = ends[trimmed] ?? (head === tail ? ends[head] : undefined);
  const name = alias ?? (trimmed.startsWith("point:") ? trimmed.slice("point:".length) : null);
  const at = name === null ? undefined : facts.report?.points[name];
  if (at !== undefined) return { at, what: trimmed };
  if (name !== null) throw new Error(t("commands-measure-no-point", { name }));
  throw new Error(t("commands-measure-bad-end", { text, forms: endForms() }));
}
