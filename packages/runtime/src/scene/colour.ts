// SPDX-License-Identifier: Apache-2.0
/**
 * The colour of a document (`#rrggbb`, or `[r, g, b]` with each part in 0..255) as a three.js colour. Both forms are
 * sRGB. three.js keeps the colour in its linear working space.
 */
import { Color, SRGBColorSpace } from "three";
import type { Colour } from "@scenity/scene/schema/common";

/** Write a document colour into `target` and return `target`. */
export function setColour(target: Color, colour: Colour): Color {
  if (typeof colour === "string") return target.setStyle(colour, SRGBColorSpace);
  const [r, g, b] = colour;
  return target.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

/** A new three.js colour from a document colour. */
export function toColor(colour: Colour): Color {
  return setColour(new Color(), colour);
}
