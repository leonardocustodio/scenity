// SPDX-License-Identifier: Apache-2.0
/**
 * Draw one lane of the metrics graph on a 2D canvas: the bands of the checks (pass, known gap, fail), the value grid
 * with its ticks, the dashed limit lines and one line for each member. The cursor and the hover line are not on the
 * canvas (MetricsGraph.vue moves them as elements). Thus a seek or a hover does not draw the canvas again.
 */
import { colorSlot, type BandKind, type MetricBands, type MetricSeries } from "./series";
import { GUTTER_PX, ticksOf, valueText, xOf, yOf, type PlotFrame } from "./scale";

/** The colors of a lane: CSS color values of the theme (`graphColors`). */
export interface LaneColors {
  /** The five series slots: the four members of S01 in sequence, then all other lines. */
  readonly series: readonly string[];
  readonly bands: Readonly<Record<BandKind, string>>;
  readonly limits: Readonly<Record<"fail" | "known", string>>;
  readonly grid: string;
  readonly text: string;
}

/** The CSS properties of the colors on the graph element (graph.css sets them for each theme). */
export const COLOR_VARS = {
  series: ["--graph-series-1", "--graph-series-2", "--graph-series-3", "--graph-series-4", "--graph-series-5"],
  pass: "--graph-band-pass",
  known: "--graph-band-known",
  fail: "--graph-band-fail",
  knownLine: "--sc-color-status-caution",
  failLine: "--sc-color-status-negative",
  grid: "--sc-color-border-subtle",
  text: "--sc-color-text-secondary",
} as const;

/** The colors of the theme from the CSS properties of an element (an absent property gives gray). */
export function graphColors(element: Element): LaneColors {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim() || "#888888";
  return {
    series: COLOR_VARS.series.map(read),
    bands: { pass: read(COLOR_VARS.pass), known: read(COLOR_VARS.known), fail: read(COLOR_VARS.fail) },
    limits: { fail: read(COLOR_VARS.failLine), known: read(COLOR_VARS.knownLine) },
    grid: read(COLOR_VARS.grid),
    text: read(COLOR_VARS.text),
  };
}

export interface LaneDraw {
  readonly context: CanvasRenderingContext2D;
  /** The size of the lane in CSS px and the device pixel ratio of the canvas. */
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly series: MetricSeries;
  readonly bands: MetricBands;
  readonly frame: PlotFrame;
  readonly colors: LaneColors;
}

const BAND_ORDER: readonly BandKind[] = ["pass", "known", "fail"];

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function drawBands(draw: LaneDraw): void {
  const { context, frame, bands, colors } = draw;
  for (const kind of BAND_ORDER) {
    context.fillStyle = colors.bands[kind];
    for (const band of bands.bands) {
      if (band.kind !== kind) continue;
      const left = xOf(frame, clamp(band.from, frame.t0, frame.t1));
      const right = xOf(frame, clamp(band.to, frame.t0, frame.t1));
      const top = yOf(frame, clamp(band.hi, frame.v0, frame.v1));
      const bottom = yOf(frame, clamp(band.lo, frame.v0, frame.v1));
      if (right - left <= 0 || bottom - top <= 0) continue;
      // A band of one moment is at least 3 px wide.
      const grow = Math.max(0, 3 - (right - left)) / 2;
      context.fillRect(left - grow, top, right - left + grow * 2, bottom - top);
    }
  }
}

function drawGrid(draw: LaneDraw): void {
  const { context, frame, colors, series } = draw;
  context.strokeStyle = colors.grid;
  context.fillStyle = colors.text;
  context.lineWidth = 1;
  context.font = "10px ui-monospace, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const tick of ticksOf(frame.v0, frame.v1, 2)) {
    const y = Math.round(yOf(frame, tick)) + 0.5;
    context.beginPath();
    context.moveTo(frame.x0, y);
    context.lineTo(frame.x1, y);
    context.stroke();
    context.fillText(valueText(tick, series.unit), GUTTER_PX - 4, clamp(y, frame.y0 + 5, frame.y1 - 5));
  }
}

function drawLimits(draw: LaneDraw): void {
  const { context, frame, bands, colors } = draw;
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  for (const limit of bands.limits) {
    if (limit.value < frame.v0 || limit.value > frame.v1) continue;
    const y = Math.round(yOf(frame, limit.value)) + 0.5;
    context.strokeStyle = colors.limits[limit.kind];
    context.beginPath();
    context.moveTo(xOf(frame, clamp(limit.from, frame.t0, frame.t1)), y);
    context.lineTo(xOf(frame, clamp(limit.to, frame.t0, frame.t1)), y);
    context.stroke();
  }
  context.setLineDash([]);
}

function drawLines(draw: LaneDraw): void {
  const { context, frame, series, colors } = draw;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const line of series.lines) {
    context.strokeStyle = colors.series[colorSlot(line.member) - 1] ?? colors.text;
    // The overlap of two members: a dashed line.
    context.setLineDash(line.member?.includes("+") === true ? [5, 3] : []);
    context.beginPath();
    let open = false;
    line.values.forEach((value, index) => {
      if (Number.isNaN(value)) {
        open = false;
        return;
      }
      const x = xOf(frame, series.times[index] ?? 0);
      const y = yOf(frame, clamp(value, frame.v0, frame.v1));
      if (open) context.lineTo(x, y);
      else context.moveTo(x, y);
      open = true;
    });
    context.stroke();
  }
  context.setLineDash([]);
}

/** Draw one lane: bands, grid, limits, lines. */
export function drawLane(draw: LaneDraw): void {
  const { context, width, height, ratio } = draw;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  drawBands(draw);
  drawGrid(draw);
  drawLimits(draw);
  drawLines(draw);
}
