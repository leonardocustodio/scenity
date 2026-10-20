// SPDX-License-Identifier: Apache-2.0
// Parts of this file come from three.js (MIT licence, copyright 2010-2026 three.js authors). See NOTICE.
/**
 * The Poisson denoise of the ambient occlusion on WebGPU: the `PoissonDenoiseShader` of `GTAOPass` (WebGL)
 * as a node, with the parameters of `GTAOPass` (16 samples on 2 rings, radius 8 pixels, luma phi 10, depth phi 2,
 * normal phi 3). `DenoiseNode` of three.js did not compile on Metal: Tint failed with "swizzle view instruction still
 * has usages after lowering" (a swizzle of an element of its uniform array of samples). This node has the samples as
 * constants and unrolls the loop, so it has no array and no vector variable to swizzle.
 */
import type { Camera, Node, TextureNode } from "three/webgpu";
import {
  abs,
  cos,
  dot,
  float,
  getViewPosition,
  int,
  max,
  pow,
  sin,
  textureSize,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

/** The parameters of the denoise of `GTAOPass`. */
const SAMPLES = 16;
const RINGS = 2;
const RADIUS = 8;
const LUMA_PHI = 10;
const DEPTH_PHI = 2;
const NORMAL_PHI = 3;

/** The sample directions and radii of `generateDenoiseSamples(16, 2, 1)` of three.js. */
const DISK = Array.from({ length: SAMPLES }, (_, i) => {
  const angle = (2 * Math.PI * RINGS * i) / SAMPLES;
  return { x: Math.cos(angle), y: Math.sin(angle), z: i / (SAMPLES - 1) };
});

type Float = Node<"float">;

/**
 * The denoised occlusion (in each colour channel, alpha 1). `occlusion` has the occlusion in its red channel, `depth`
 * and `normal` are the depth and the view normals of the scene, `noise` turns the disk of each pixel.
 */
export function poissonDenoise(
  occlusion: TextureNode,
  depth: TextureNode,
  normal: TextureNode,
  noise: TextureNode,
  camera: Camera,
): Node<"vec4"> {
  const inverse = uniform(camera.projectionMatrixInverse);
  const at = uv();
  const resolution = vec2(textureSize(depth, int(0)) as unknown as Node<"vec2">);
  const centreDepth = depth.sample(at).x as Float;
  const viewNormal = normal.sample(at).xyz.normalize();
  const centre = occlusion.sample(at).x as Float;
  const viewPosition = getViewPosition(at, centreDepth, inverse);
  // The noise uses the uv of WebGL (y up), as DenoiseNode does.
  const noiseUv = vec2(at.x, at.y.oneMinus()).mul(
    resolution.div(vec2(textureSize(noise, int(0)) as unknown as Node<"vec2">)),
  );
  const angle = (noise.sample(noiseUv).x as Float).mul(2 * Math.PI);
  const nx = sin(angle);
  const ny = cos(angle);
  let sum: Float = centre;
  let total: Float = float(1);
  for (const sample of DISK) {
    const scale = 1 + sample.z * (RADIUS - 1);
    const bx = float(sample.x * scale).div(resolution.x);
    const by = float(sample.y * scale).div(resolution.y);
    // The rotation of GLSL `mat2(nx, -ny, nx, ny) * b`.
    const sampleUv = at.add(vec2(nx.mul(bx.add(by)), ny.mul(by.sub(bx))));
    const sampleDepth = depth.sample(sampleUv).x as Float;
    const sampleNormal = normal.sample(sampleUv).xyz.normalize();
    const value = occlusion.sample(sampleUv).x as Float;
    const samplePosition = getViewPosition(sampleUv, sampleDepth, inverse);
    const normalWeight = pow(max(dot(viewNormal, sampleNormal), 0), NORMAL_PHI);
    const lumaWeight = max(float(1).sub(abs(value.sub(centre)).div(LUMA_PHI)), 0);
    const depthWeight = max(float(1).sub(abs(dot(viewPosition.sub(samplePosition), viewNormal)).div(DEPTH_PHI)), 0);
    const weight = lumaWeight.mul(depthWeight).mul(normalWeight) as Float;
    sum = sum.add(value.mul(weight));
    total = total.add(weight);
  }
  // The background (depth 1) has no occlusion, as the cleared target of GTAOPass.
  const result = centreDepth.greaterThanEqual(1).select(float(1), sum.div(total)) as Float;
  return vec4(result, result, result, 1);
}
