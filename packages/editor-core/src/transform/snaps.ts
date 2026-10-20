// SPDX-License-Identifier: Apache-2.0
/**
 * The snaps of a transform edit: the grid of a move, the angle step of a turn, the step of a scale factor, and the snap
 * of a free move to surfaces and sockets. Each snap has a switch and a step. Alt held during a drag disables each
 * snap. Shift during a move gives a grid ten times larger (the lab rule). The
 * functions are pure.
 */
import { roundNumber } from "@scenity/scene/canonical";

/** The snap settings of an editor. */
export interface SnapSettings {
  /** The grid of a move (metres) and its switch. */
  readonly grid: number;
  readonly gridOn: boolean;
  /** The angle step of a turn (degrees) and its switch. */
  readonly angle: number;
  readonly angleOn: boolean;
  /** The step of a scale factor and its switch. */
  readonly scale: number;
  readonly scaleOn: boolean;
  /** A free move snaps to the surface under the pointer and to a socket near it. */
  readonly surface: boolean;
}

/** The default snaps: the 1 cm grid and the 15° turn of the lab, a scale step of 0.1, and the surface snap. */
export const DEFAULT_SNAPS: SnapSettings = {
  grid: 0.01,
  gridOn: true,
  angle: 15,
  angleOn: true,
  scale: 0.1,
  scaleOn: true,
  surface: true,
};

/** The keys that change the snaps of a drag. */
export interface SnapKeys {
  readonly alt: boolean;
  readonly shift: boolean;
}

/** The steps that apply to one drag: 0 is no snap. The angle is in radians. */
export interface ActiveSnaps {
  readonly grid: number;
  readonly angle: number;
  readonly scale: number;
  readonly surface: boolean;
}

/** The steps of a drag from the settings and the keys. */
export function activeSnaps(settings: SnapSettings, keys: SnapKeys): ActiveSnaps {
  if (keys.alt) return { grid: 0, angle: 0, scale: 0, surface: false };
  const grid = settings.gridOn && settings.grid > 0 ? settings.grid * (keys.shift ? 10 : 1) : 0;
  return {
    grid,
    angle: settings.angleOn && settings.angle > 0 ? (settings.angle * Math.PI) / 180 : 0,
    scale: settings.scaleOn && settings.scale > 0 ? settings.scale : 0,
    surface: settings.surface,
  };
}

/** A value on the grid of a step (0: no grid), then on the number grid of the documents. */
export function snapStep(value: number, step: number): number {
  return roundNumber(step > 0 ? Math.round(value / step) * step : value);
}

/** A scale factor with its change from 1 on the grid of a step: the factor 1.23 with the step 0.1 gives 1.2. */
export function snapFactor(factor: number, step: number): number {
  return step > 0 ? roundNumber(1 + Math.round((factor - 1) / step) * step) : factor;
}

/**
 * The number of a typed value (values by keyboard), or null while the text is not a number yet. A comma is also a
 * decimal point, so "0,5" gives 0.5.
 */
export function typedNumber(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** The next text of a typed value after a key, or null when the key is not part of a number. */
export function typedKey(text: string, key: string): string | null {
  if (key === "Backspace") return text.slice(0, -1);
  if (/^\d$/.test(key)) return text + key;
  if ((key === "." || key === ",") && !/[.,]/.test(text)) return text + ".";
  // The minus key changes the sign at any place of the text.
  if (key === "-") return text.startsWith("-") ? text.slice(1) : `-${text}`;
  return null;
}
