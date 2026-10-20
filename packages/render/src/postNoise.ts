// SPDX-License-Identifier: Apache-2.0
/**
 * The noise texture of the Poisson denoise of the ambient occlusion. `GTAOPass` (WebGL) and `DenoiseNode` (WebGPU)
 * make the same 64 × 64 simplex noise, but each one from `Math.random`. With that noise, two pages draw different
 * frames: the worker and the main thread are different, and the backends are more different. This texture has the
 * same form from a seeded random stream, so each page and each backend gets the same noise.
 */
import { DataTexture, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";

const SIZE = 64;
const SEED = 0x5ce313;

/** A seeded random stream (mulberry32) with the `random()` method that `SimplexNoise` reads. */
function seededRandom(seed: number): { random(): number } {
  let state = seed >>> 0;
  return {
    random: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A new noise texture of the denoise: the texture of `GTAOPass._generateNoise` from the seeded stream. */
export function denoiseNoise(): DataTexture {
  const simplex = new SimplexNoise(seededRandom(SEED));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      const at = (i * SIZE + j) * 4;
      data[at] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[at + 1] = (simplex.noise(i + SIZE, j) * 0.5 + 0.5) * 255;
      data[at + 2] = (simplex.noise(i, j + SIZE) * 0.5 + 0.5) * 255;
      data[at + 3] = (simplex.noise(i + SIZE, j + SIZE) * 0.5 + 0.5) * 255;
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
