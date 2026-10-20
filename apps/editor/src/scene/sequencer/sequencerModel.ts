// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the sequencer panel. It gives the rows of the track list (one group for each entity, with the audio
 * tracks), the place of a time on a lane, the ticks of the time ruler and the curves of the curve editor. The scales
 * are the scales of the metrics graph of the lab (core/graph/scale.ts). The model is pure and has no Vue. The line
 * label of a position axis is a Fluent message of `src/i18n/en-US/sequencer.ftl`.
 */
import { trackGroups, trackLabel } from "@scenity/editor-core";
import { t } from "../../texts";
import type { EntityDocument } from "@scenity/scene";
import { sampleTrack, type SequenceDocument, type Track } from "@scenity/scene/sequence";
import { niceStep, ticksOf, timeOf, xOf, yOf, type PlotFrame } from "../../core/graph/scale";

/** One key on a lane: its index in the track and its time. */
export interface LaneKey {
  readonly index: number;
  readonly t: number;
}

/** One row of the track list: an entity group, or a track with its keys. */
export type SequencerRow =
  | { readonly kind: "group"; readonly id: string; readonly label: string; readonly entity: string | null }
  | {
      readonly kind: "track";
      readonly id: string;
      readonly label: string;
      readonly track: number;
      readonly trackKind: Track["kind"];
      readonly keys: readonly LaneKey[];
    };

/** The rows of the track list. */
export function sequencerRows(sequence: SequenceDocument, scene: EntityDocument): SequencerRow[] {
  const rows: SequencerRow[] = [];
  for (const group of trackGroups(sequence, scene)) {
    rows.push({ kind: "group", id: `group:${group.entity ?? ""}`, label: group.label, entity: group.entity });
    for (const index of group.tracks) {
      const track = sequence.tracks[index];
      if (track === undefined) continue;
      const keys = track.keys.map((key, at) => ({ index: at, t: key.t }));
      rows.push({
        kind: "track",
        id: `track:${String(index)}`,
        label: trackLabel(track),
        track: index,
        trackKind: track.kind,
        keys,
      });
    }
  }
  return rows;
}

/** The frame of a lane: the time line over `width` px. */
export function laneFrame(duration: number, width: number): PlotFrame {
  return { x0: 0, x1: Math.max(1, width), y0: 0, y1: 1, t0: 0, t1: Math.max(1, duration), v0: 0, v1: 1 };
}

/** The share (0 to 100) of a time on the time line, for a CSS left value. */
export function timeShare(t: number, duration: number): number {
  return (xOf(laneFrame(duration, 100), Math.min(Math.max(0, t), duration)) / 100) * 100;
}

/** The whole ms at x px of a lane of `width` px. */
export function timeAtX(x: number, duration: number, width: number): number {
  return Math.round(timeOf(laneFrame(duration, width), x));
}

/** The ticks of the time ruler (ms): about eight round steps. */
export function rulerTicks(duration: number): number[] {
  return ticksOf(0, Math.max(1, duration), 8);
}

/** The time as seconds with two decimals ("2.50 s"). */
export function secondsText(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** One line of the curve editor: a number value of each key over the time line. */
export interface CurveLine {
  readonly label: string;
  /** The index of the track of the line. */
  readonly track: number;
  /** The keys that hold the value: the key index, its time and its value. */
  readonly points: readonly { readonly key: number; readonly t: number; readonly value: number }[];
  /** The value at each sample time (`samples` of `curveOf`). */
  readonly values: readonly number[];
  /** The JSON value of a key with a new number for this line (a `sequence.key.value` argument). */
  readonly valueWith: (key: number, value: number) => string;
}

/** The curves of a track: a line per number of a property or of a transform position; empty for another track. */
export interface Curve {
  readonly lines: readonly CurveLine[];
  readonly samples: readonly number[];
  readonly min: number;
  readonly max: number;
}

const SAMPLE_COUNT = 96;
const AXES = ["x", "y", "z"] as const;

/** The number list of a key of a curve track, or null. */
function numbersOf(track: Track, key: Track["keys"][number]): number[] | null {
  const value: unknown =
    track.kind === "property" ? (key as { value?: unknown }).value : (key as { position?: unknown }).position;
  if (typeof value === "number") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? value : null;
}

/** The number list of a sample of a curve track at `t`, or null. */
function sampleNumbers(track: Track, t: number): number[] | null {
  const sample = sampleTrack(track, t);
  const value: unknown =
    sample.kind === "property" ? sample.value : sample.kind === "transform" ? sample.position : null;
  if (typeof value === "number") return [value];
  return Array.isArray(value) ? (value as number[]) : null;
}

/** The JSON of a key with a new value of one number (`part` of a list, -1 for a plain number). */
function valueJson(track: Track, numbers: readonly number[], part: number, value: number): string {
  const next = part < 0 ? value : numbers.map((item, index) => (index === part ? value : item));
  return JSON.stringify(track.kind === "property" ? next : { position: next });
}

/** One line of a curve: the number `part` of each key (-1: the key value is a plain number). */
function curveLine(track: Track, part: number, label: string, samples: readonly number[], index: number): CurveLine {
  const points = track.keys.flatMap((key, index) => {
    const numbers = numbersOf(track, key);
    const value = numbers?.[Math.max(0, part)];
    return value === undefined ? [] : [{ key: index, t: key.t, value }];
  });
  return {
    label,
    track: index,
    points,
    values: samples.map((t) => sampleNumbers(track, t)?.[Math.max(0, part)] ?? Number.NaN),
    valueWith: (key, value) => valueJson(track, numbersOf(track, track.keys[key] ?? { t: 0 }) ?? [], part, value),
  };
}

/** The curve of a track over the time line, or null for a track with no number keys. */
export function curveOf(track: Track | undefined, duration: number, index = -1): Curve | null {
  if (track === undefined || (track.kind !== "property" && track.kind !== "transform")) return null;
  const first = track.keys.map((key) => numbersOf(track, key)).find((numbers) => numbers !== null);
  if (first === undefined) return null;
  const samples = Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => Math.round((index / SAMPLE_COUNT) * duration));
  const plain = track.kind === "property" && typeof (track.keys[0] as { value?: unknown }).value === "number";
  const lines = plain
    ? [curveLine(track, -1, trackLabel(track), samples, index)]
    : first.map((_, part) =>
        curveLine(
          track,
          part,
          track.kind === "transform"
            ? t("sequencer-curve-position", { axis: AXES[part] ?? String(part) })
            : `${trackLabel(track)} ${String(part)}`,
          samples,
          index,
        ),
      );
  const values = lines
    .flatMap((line) => [...line.values, ...line.points.map((point) => point.value)])
    .filter(Number.isFinite);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = high - low < 1e-6 ? 1 : (high - low) * 0.1;
  const step = niceStep(high - low + pad * 2, 4);
  return { lines, samples, min: Math.floor((low - pad) / step) * step, max: Math.ceil((high + pad) / step) * step };
}

/**
 * The curves of some tracks of a sequence as one curve: the lines of each track and one value range. When there is
 * more than one track, each line label starts with the track label. The result is null when no track has number keys.
 */
export function curvesOf(sequence: SequenceDocument, indexes: readonly number[]): Curve | null {
  const curves = indexes.flatMap((index) => {
    const curve = curveOf(sequence.tracks[index], sequence.duration, index);
    return curve === null ? [] : [{ index, curve }];
  });
  const first = curves[0];
  if (first === undefined) return null;
  if (curves.length === 1) return first.curve;
  const lines = curves.flatMap(({ index, curve }) => {
    const track = sequence.tracks[index];
    const label = track === undefined ? "" : trackLabel(track);
    return curve.lines.map((line) => ({ ...line, label: line.label === label ? label : `${label}: ${line.label}` }));
  });
  return {
    lines,
    samples: first.curve.samples,
    min: Math.min(...curves.map(({ curve }) => curve.min)),
    max: Math.max(...curves.map(({ curve }) => curve.max)),
  };
}

/** The indexes of the tracks that the curve editor can show (number keys). */
export function curveTracks(sequence: SequenceDocument): number[] {
  return sequence.tracks.flatMap((track, index) => (curveOf(track, sequence.duration) === null ? [] : [index]));
}

/** The plot frame of the curve editor. */
export function curveFrame(
  curve: Curve,
  window: { readonly from: number; readonly to: number },
  width: number,
  height: number,
): PlotFrame {
  return {
    x0: 0,
    x1: Math.max(1, width),
    y0: 4,
    y1: Math.max(8, height - 4),
    t0: window.from,
    t1: Math.max(window.from + 1, window.to),
    v0: curve.min,
    v1: curve.max,
  };
}

/** The SVG path of a curve line. */
export function linePath(frame: PlotFrame, samples: readonly number[], values: readonly number[]): string {
  const parts: string[] = [];
  samples.forEach((t, index) => {
    const value = values[index] ?? Number.NaN;
    if (!Number.isFinite(value)) return;
    parts.push(`${parts.length === 0 ? "M" : "L"}${xOf(frame, t).toFixed(1)},${yOf(frame, value).toFixed(1)}`);
  });
  return parts.join(" ");
}

/** The value at y px of a curve frame, rounded to 4 decimals. */
export function valueAtY(frame: PlotFrame, y: number): number {
  const share = (frame.y1 - y) / (frame.y1 - frame.y0 || 1);
  return Math.round((frame.v0 + share * (frame.v1 - frame.v0)) * 1e4) / 1e4;
}
