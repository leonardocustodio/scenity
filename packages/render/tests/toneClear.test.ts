// SPDX-License-Identifier: Apache-2.0
// The background colour of the WebGPU backend (src/toneClear.ts). The backend clears with the colour that ACES Filmic
// changes back to the plain colour, so WebGPU shows the background pixels of WebGL.
import { describe, expect, it } from "bun:test";
import { Color } from "three";
import { acesFilmic, plainClear, unAcesFilmic } from "../src/toneClear";

const EXPOSURE = 1.05;

/** The 8-bit sRGB value of a linear value, as the output of both renderers. */
function srgb8(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

function pixel(color: readonly number[]): number[] {
  return color.map(srgb8);
}

describe("the WebGPU background colour", () => {
  it("gives the pixels of the measured WebGPU frames without the fix", () => {
    // The panes test measured pure green 0,255,0 on WebGL and 153,230,93 on WebGPU (±1 for the half-float target).
    const green = new Color(0x00ff00);
    const shown = pixel(acesFilmic([green.r, green.g, green.b], EXPOSURE));
    expect(shown.map((value, index) => Math.abs(value - [153, 230, 93][index]!))).toEqual([1, 1, 0]);
  });

  it("changes the room background back to its plain pixels", () => {
    for (const hex of [0x1a2433, 0x000000, 0x808080, 0xffffff, 0x203040]) {
      const plain = new Color(hex);
      const cleared = unAcesFilmic([plain.r, plain.g, plain.b], EXPOSURE);
      const shown = pixel(acesFilmic(cleared, EXPOSURE));
      expect(shown, hex.toString(16)).toEqual(pixel([plain.r, plain.g, plain.b]));
    }
  });

  it("sets the colour for one frame and sets the plain colour again", () => {
    const background = new Color(0x1a2433);
    const before = background.clone();
    const restore = plainClear(background, EXPOSURE);
    expect(background.equals(before)).toBe(false);
    expect(pixel(acesFilmic([background.r, background.g, background.b], EXPOSURE))).toEqual([26, 36, 51]);
    restore();
    expect(background.equals(before)).toBe(true);
    // The same colour gives the same clear colour (the memo).
    const first = plainClear(background, EXPOSURE);
    const value = background.clone();
    first();
    plainClear(background, EXPOSURE)();
    const again = plainClear(background, EXPOSURE);
    expect(background.equals(value)).toBe(true);
    again();
  });
});
