// SPDX-License-Identifier: Apache-2.0
/**
 * The background colour of the WebGPU backend.
 *
 * The classic WebGL renderer clears the canvas with the background colour of the scene: the tone mapping does not
 * change it. The WebGPU renderer of three.js draws the scene into a render target and then applies the tone mapping
 * and the sRGB output to all of the target, so the background colour goes through ACES Filmic too. The two backends
 * then show different background pixels (for example 0x1a2433 gives 26,36,51 on WebGL and 9,19,34 on WebGPU).
 *
 * The fix: before each output frame, the WebGPU backend sets the background to the colour that ACES Filmic changes
 * back to the plain colour (the inverse of the ACES fit of three.js). After the frame, it sets the plain colour
 * again. A colour that ACES cannot give (a saturated primary colour) gets the nearest value in the range of the fit.
 *
 * With the direct output of render/webgpu.ts, only an output frame with the scissor test (a pane of the labs core)
 * uses this fix. The direct pipeline draws the background of the pane as a mesh with the output of the materials. A
 * frame without the scissor test clears the canvas with the sRGB value of the colour, as WebGL does.
 *
 * This module has no imports with bytes: the WebGL entries do not use it.
 */

/** The parts of a three.js `Color` that this module uses (linear working colour space). */
export interface LinearColor {
  r: number;
  g: number;
  b: number;
}

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

/** sRGB → ACES AP1 with the RRT saturation (the rows of `ACESInputMat` of three.js r186). */
const ACES_INPUT: Mat3 = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];

/** The ODT saturation → sRGB (the rows of `ACESOutputMat` of three.js r186). */
const ACES_OUTPUT: Mat3 = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

/** The exposure divisor of the ACES Filmic function of three.js. */
const EXPOSURE_DIVISOR = 0.6;

function times(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function inverse(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const INPUT_INVERSE = inverse(ACES_INPUT);
const OUTPUT_INVERSE = inverse(ACES_OUTPUT);

/** The RRT and ODT fit of three.js for one channel. */
function fit(v: number): number {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/** The lowest and the highest value of the fit for v ≥ 0. */
const FIT_LOW = fit(0);
const FIT_HIGH = 1 / 0.983729;

/** The value v ≥ 0 that the fit changes to `f` (the positive root of a quadratic), with `f` kept in the range. */
function unfit(f: number): number {
  const y = Math.min(FIT_HIGH - 1e-6, Math.max(FIT_LOW, f));
  const a = 1 - 0.983729 * y;
  const b = 0.0245786 - 0.432951 * y;
  const c = -(0.000090537 + 0.238081 * y);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** ACES Filmic of three.js on a linear colour (before the sRGB output), clamped to [0, 1]. */
export function acesFilmic(color: Vec3, exposure: number): Vec3 {
  const scaled: Vec3 = [
    (color[0] * exposure) / EXPOSURE_DIVISOR,
    (color[1] * exposure) / EXPOSURE_DIVISOR,
    (color[2] * exposure) / EXPOSURE_DIVISOR,
  ];
  const fitted = times(ACES_INPUT, scaled).map(fit) as unknown as Vec3;
  return times(ACES_OUTPUT, fitted).map((value) => Math.min(1, Math.max(0, value))) as unknown as Vec3;
}

/** The linear colour that `acesFilmic` changes to `target` (the nearest one when no colour gives `target`). */
export function unAcesFilmic(target: Vec3, exposure: number): Vec3 {
  const fitted = times(OUTPUT_INVERSE, target).map(unfit) as unknown as Vec3;
  const scaled = times(INPUT_INVERSE, fitted);
  return [
    (scaled[0] * EXPOSURE_DIVISOR) / exposure,
    (scaled[1] * EXPOSURE_DIVISOR) / exposure,
    (scaled[2] * EXPOSURE_DIVISOR) / exposure,
  ];
}

/** The last colour that the clear changed, and its result. The colour of the room stays the same in each frame. */
let memo: { readonly key: string; readonly value: Vec3 } | null = null;

/**
 * Set `color` to the colour that ACES Filmic changes back to it, and give a function that sets the plain colour again.
 * The WebGPU renderer calls it before an output frame with ACES Filmic tone mapping (webgpu.ts).
 */
export function plainClear(color: LinearColor, exposure: number): () => void {
  const plain: Vec3 = [color.r, color.g, color.b];
  const key = `${String(plain[0])},${String(plain[1])},${String(plain[2])},${String(exposure)}`;
  if (memo?.key !== key) memo = { key, value: unAcesFilmic(plain, exposure) };
  [color.r, color.g, color.b] = memo.value;
  return () => {
    [color.r, color.g, color.b] = plain;
  };
}
