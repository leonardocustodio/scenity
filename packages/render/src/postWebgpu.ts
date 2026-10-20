// SPDX-License-Identifier: Apache-2.0
/**
 * The effects of the WebGPU backend: a `RenderPipeline` of the node passes of `three/tsl` (postTypes.ts gives the
 * order). The document core of `documentCoreGpu.ts` loads this module as a lazy chunk when the scene enables an
 * effect. `three/tsl` keeps every node of three.js in the chunk. The WebGPU room entries do not import it.
 *
 * The passes copy the WebGL passes of postWebgl.ts: GTAO with the Poisson denoise, the colour times
 * `mix(1, ao, intensity)` as `GTAOPass` blends it; the Unreal bloom added to the colour; the outline edges times the
 * colour and the strength, added as `OutlinePass` adds them; SMAA before the output and FXAA after it.
 *
 * The output: the pipeline applies the tone mapping and the sRGB output itself (`renderOutput`). The WebGPU backend
 * (webgpu.ts) draws a frame of the canvas through its direct pipeline, which applies them in each material. The quad
 * of this pipeline must not get them two times, so the frame sets the flag of the direct pipeline (`inDirect`) while
 * it draws. The renderer then draws each call as it is.
 */
import { RenderPipeline, type Node, type Object3D, type Renderer } from "three/webgpu";
import {
  convertToTexture,
  float,
  mix,
  mrt,
  normalView,
  pass,
  renderOutput,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import type OutlineNode from "three/examples/jsm/tsl/display/OutlineNode.js";
import { outline } from "three/examples/jsm/tsl/display/OutlineNode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import { poissonDenoise } from "./aoDenoise";
import { denoiseNoise } from "./postNoise";
import { HIDDEN_EDGE_SHARE, type PostFactory, type PostPipeline, type PostSettings } from "./postTypes";

/** The samples of the scene pass for `msaa`. */
const MSAA_SAMPLES = 4;

/** The flag of the direct pipeline of the WebGPU backend (webgpu.ts `GpuRenderer`). */
interface DirectFlag {
  inDirect: boolean;
}

type ColourNode = Node<"vec4">;

/** The colour times the ambient occlusion, with the depth and the normals of the scene pass. */
function withOcclusion(
  colour: ColourNode,
  scene: Parameters<PostFactory>[1],
  camera: Parameters<PostFactory>[2],
  value: NonNullable<PostSettings["ao"]>,
): ColourNode {
  // A pass of its own with one sample for the depth and the normals, as GTAOPass renders its own normal pass on
  // WebGL. A multisampled depth texture cannot go into GTAO.
  const prePass = pass(scene, camera, { samples: 0 });
  prePass.setMRT(mrt({ output: normalView }));
  const depth = prePass.getTextureNode("depth");
  const normal = prePass.getTextureNode("output");
  const occlusion = ao(depth, normal, camera);
  occlusion.radius.value = value.radius;
  // The denoise of GTAOPass with the seeded noise (aoDenoise.ts, postNoise.ts), in a texture of its own.
  const smooth = convertToTexture(
    poissonDenoise(occlusion.getTextureNode(), depth, normal, texture(denoiseNoise()), camera),
  ) as unknown as ColourNode;
  const factor = mix(float(1), smooth.r, float(value.intensity));
  // The alpha stays: the factor of the alpha channel is 1.
  return colour.mul(vec4(vec3(factor), 1));
}

/** The colour plus the outline edges of the selection. */
function withOutline(colour: ColourNode, edges: OutlineNode, value: NonNullable<PostSettings["outline"]>): ColourNode {
  const [r, g, b] = value.colour;
  const visible = vec3(r, g, b);
  const hidden = vec3(r * HIDDEN_EDGE_SHARE, g * HIDDEN_EDGE_SHARE, b * HIDDEN_EDGE_SHARE);
  const edge = visible.mul(edges.visibleEdge).add(hidden.mul(edges.hiddenEdge)).mul(value.strength);
  return colour.add(vec4(edge, 0));
}

/** The WebGPU pipeline of the effects of `settings`. */
export const createWebGPUPost: PostFactory = (renderer, scene, camera, settings) => {
  const gpu = renderer as unknown as Renderer;
  if (!("inDirect" in gpu)) throw new Error("the WebGPU effects need the renderer of @scenity/render/webgpu");
  // The pass takes the samples of the canvas when it gives none: one sample, unless the effects ask for MSAA.
  const scenePass = pass(scene, camera, { samples: settings.antialias === "msaa" ? MSAA_SAMPLES : 0 });
  let colour = scenePass.getTextureNode("output") as unknown as ColourNode;
  if (settings.ao !== null) colour = withOcclusion(colour, scene, camera, settings.ao);
  if (settings.bloom !== null) {
    const { strength, radius, threshold } = settings.bloom;
    colour = colour.add(bloom(colour, strength, radius, threshold));
  }
  let edges: OutlineNode | null = null;
  if (settings.outline !== null) {
    edges = outline(scene, camera, {
      selectedObjects: [],
      edgeThickness: uniform(settings.outline.thickness),
      edgeGlow: uniform(0),
    });
    colour = withOutline(colour, edges, settings.outline);
  }
  if (settings.antialias === "smaa") colour = smaa(colour) as unknown as ColourNode;
  let final: Node = renderOutput(colour);
  if (settings.antialias === "fxaa") final = fxaa(final);
  const pipeline = new RenderPipeline(gpu, final);
  pipeline.outputColorTransform = false;
  return Promise.resolve(new WebGPUPost(gpu as Renderer & DirectFlag, pipeline, edges));
};

/** The render pipeline of the effects. */
class WebGPUPost implements PostPipeline {
  constructor(
    private readonly renderer: Renderer & DirectFlag,
    private readonly pipeline: RenderPipeline,
    private readonly edges: OutlineNode | null,
  ) {}

  render(selected: readonly Object3D[]): void {
    if (this.edges !== null) this.edges.selectedObjects = [...selected];
    const before = this.renderer.inDirect;
    this.renderer.inDirect = true;
    try {
      this.pipeline.render();
    } finally {
      this.renderer.inDirect = before;
    }
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
