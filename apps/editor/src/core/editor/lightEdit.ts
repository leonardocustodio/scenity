// SPDX-License-Identifier: Apache-2.0
/**
 * The light of the scene editor: pure functions from the inputs (the tune values of `light`, model/light.ts) to the
 * current light and the tune ops of a change. The runtime sets its lights from the tuned numbers. Thus a light change
 * is an input of the frame, as a prop place is. `labs tune-apply` writes it into the scene document of the room.
 *
 * - **The key light handle.** The key light comes from its position (`light.key.at`) toward its aim
 *   (`light.key.aim`). The handle is a point on the sphere around the aim at HANDLE_RADIUS, in the direction of the
 *   light. A drag of the handle turns the direction, and the light keeps its distance from the aim.
 * - **Intensity and colour.** The key, the fill and the sky light have an intensity. The key, the fill, the sky and the
 *   ground (the lower colour of the sky light) have a colour, sRGB 0 to 255 per channel.
 *
 * No Vue import: the commands and the tests read it.
 */
import type { Vec3 } from "@scenity/character";
import type { OverlaySpec } from "@scenity/runtime-dev";
import { grid } from "./commandKit";
import type { TuneOp } from "./ops";
import { t } from "../../texts";

// The tunable `light` (model/light.ts of the room) is in the tune registry of the page. The room face of the plugin
// imports it (`EditorRoom.light`), and the page has no core.

/** The lights with an intensity. */
export const LIGHT_PARTS = ["key", "fill", "sky"] as const;
export type LightPart = (typeof LIGHT_PARTS)[number];
/** The colours of the light: the key, the fill, the sky and the ground colour of the sky light. */
export const COLOUR_PARTS = ["key", "fill", "sky", "ground"] as const;
export type ColourPart = (typeof COLOUR_PARTS)[number];
/** The lights with a position. */
export const PLACED_PARTS = ["key", "fill"] as const;
export type PlacedPart = (typeof PLACED_PARTS)[number];

export type Rgb = readonly [number, number, number];

/** The distance of the key light handle from the aim of the key light (metres). */
export const HANDLE_RADIUS = 0.9;
/** The lowest direction of the key light: the share of up in its direction (the light stays above its aim). */
const MIN_UP = 0.15;

/** The prefix of the tune paths of the light. */
export const LIGHT_PREFIX = "light.";

export function intensityPath(part: LightPart): string {
  return `light.${part}.intensity`;
}

export function colourPaths(part: ColourPart): readonly [string, string, string] {
  const base = part === "ground" ? "light.sky.ground" : `light.${part}.colour`;
  return [`${base}.0`, `${base}.1`, `${base}.2`];
}

export function lightPlacePaths(part: PlacedPart | "aim"): readonly [string, string, string] {
  const base = part === "aim" ? "light.key.aim" : `light.${part}.at`;
  return [`${base}.0`, `${base}.1`, `${base}.2`];
}

/** The current light: the tune values, else the defaults (the values of model/light.ts). */
export interface LightView {
  readonly key: { readonly at: Vec3; readonly aim: Vec3; readonly intensity: number; readonly colour: Rgb };
  readonly fill: { readonly at: Vec3; readonly intensity: number; readonly colour: Rgb };
  readonly sky: { readonly intensity: number; readonly colour: Rgb; readonly ground: Rgb };
}

type Values = Readonly<Record<string, number>>;

function triple(paths: readonly [string, string, string], tunes: Values, defaults: ReadonlyMap<string, number>): Vec3 {
  const [a, b, c] = paths.map((path) => tunes[path] ?? defaults.get(path) ?? 0);
  return [a ?? 0, b ?? 0, c ?? 0];
}

function one(path: string, tunes: Values, defaults: ReadonlyMap<string, number>): number {
  return tunes[path] ?? defaults.get(path) ?? 0;
}

/** The light of the tune values (else the defaults), or null when the runtime has no light tunables. */
export function lightOf(tunes: Values, defaults: ReadonlyMap<string, number>): LightView | null {
  if (!defaults.has(intensityPath("key"))) return null;
  return {
    key: {
      at: triple(lightPlacePaths("key"), tunes, defaults),
      aim: triple(lightPlacePaths("aim"), tunes, defaults),
      intensity: one(intensityPath("key"), tunes, defaults),
      colour: triple(colourPaths("key"), tunes, defaults),
    },
    fill: {
      at: triple(lightPlacePaths("fill"), tunes, defaults),
      intensity: one(intensityPath("fill"), tunes, defaults),
      colour: triple(colourPaths("fill"), tunes, defaults),
    },
    sky: {
      intensity: one(intensityPath("sky"), tunes, defaults),
      colour: triple(colourPaths("sky"), tunes, defaults),
      ground: triple(colourPaths("ground"), tunes, defaults),
    },
  };
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** The point of the key light handle: on the sphere around the aim, in the direction of the light. */
export function keyHandle(view: LightView): Vec3 {
  const { aim } = view.key;
  const dir = unit(minus(view.key.at, aim));
  return [aim[0] + dir[0] * HANDLE_RADIUS, aim[1] + dir[1] * HANDLE_RADIUS, aim[2] + dir[2] * HANDLE_RADIUS];
}

/**
 * The position of the key light for a handle point: the direction from the aim to the point (at least MIN_UP up), at
 * the current distance of the light from its aim, on the grid of the commands.
 */
export function keyFromHandle(view: LightView, point: Vec3): Vec3 {
  const { aim, at } = view.key;
  const distance = Math.hypot(...minus(at, aim));
  let dir = unit(minus(point, aim));
  if (dir[1] < MIN_UP) {
    const flat = Math.hypot(dir[0], dir[2]) || 1;
    const side = Math.sqrt(1 - MIN_UP * MIN_UP) / flat;
    dir = [dir[0] * side, MIN_UP, dir[2] * side];
  }
  return [grid(aim[0] + dir[0] * distance), grid(aim[1] + dir[1] * distance), grid(aim[2] + dir[2] * distance)];
}

/** The tune ops of three numbers at their paths (on the grid of the commands). */
function tripleOps(paths: readonly [string, string, string], value: Vec3 | Rgb): TuneOp[] {
  return paths.map((path, axis) => ({ kind: "tune", path, value: grid(value[axis] ?? 0) }));
}

/** The tune ops that put a light (or the aim of the key light) at a place. */
export function moveOps(part: PlacedPart | "aim", at: Vec3): TuneOp[] {
  return tripleOps(lightPlacePaths(part), at);
}

export function intensityOps(part: LightPart, value: number): TuneOp[] {
  return [{ kind: "tune", path: intensityPath(part), value: grid(Math.max(0, value)) }];
}

/** The tune ops of a colour (each channel 0 to 255). */
export function colourOps(part: ColourPart, rgb: Rgb): TuneOp[] {
  const clamped: Rgb = [0, 1, 2].map((axis) => Math.min(255, Math.max(0, rgb[axis] ?? 0))) as unknown as Rgb;
  return tripleOps(colourPaths(part), clamped);
}

/** The tune ops that return the tuned values of a light (or of the whole light) to the defaults. */
export function lightResetOps(tunes: Values, part: LightPart | null): TuneOp[] {
  const prefix = part === null ? LIGHT_PREFIX : `light.${part}.`;
  return Object.keys(tunes)
    .filter((path) => path.startsWith(prefix))
    .map((path): TuneOp => ({ kind: "tune", path, value: null }));
}

/** A colour as `#rrggbb` (the value of a colour field). */
export function hexOf(rgb: Rgb): string {
  return `#${rgb
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A colour from `#rrggbb`, `rrggbb` or `r,g,b` (0 to 255), or null. */
export function parseColour(text: string): Rgb | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(text.trim())?.[1];
  if (hex !== undefined) {
    return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;
  }
  const parts = text.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return null;
  return parts as unknown as Rgb;
}

/** The degrees of the key light above the horizontal, and its turn about the vertical (0: from the south, +z). */
export function keyAngles(view: LightView): { readonly up: number; readonly turn: number } {
  const dir = unit(minus(view.key.at, view.key.aim));
  const deg = 180 / Math.PI;
  return { up: Math.asin(dir[1]) * deg, turn: Math.atan2(dir[0], dir[2]) * deg };
}

/**
 * The shapes of the key light handle: the line from the aim to the handle and the dots of both (the tone `handle`),
 * and a label. `ghost` adds the handle of a proposed light, faint.
 */
export function lightShapes(view: LightView, dragging: boolean, ghost: LightView | null = null): OverlaySpec {
  const handle = keyHandle(view);
  const { up, turn } = keyAngles(view);
  const angles = { intensity: view.key.intensity.toFixed(2), up: up.toFixed(0), turn: turn.toFixed(0) };
  const lines: OverlaySpec["lines"][number][] = [{ points: [view.key.aim, handle], tone: "handle" }];
  const dots: OverlaySpec["dots"][number][] = [
    { at: handle, tone: "handle" },
    { at: view.key.aim, tone: "handle" },
  ];
  if (ghost !== null) {
    const point = keyHandle(ghost);
    lines.push({ points: [ghost.key.aim, point], tone: "ghost" });
    dots.push({ at: point, tone: "ghost" });
  }
  const text = dragging ? t("commands-light-handle-label", angles) : t("commands-light-handle-label-drag", angles);
  return { lines, dots, labels: [{ at: handle, text, tone: "handle" }] };
}
