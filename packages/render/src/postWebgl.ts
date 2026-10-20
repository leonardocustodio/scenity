// SPDX-License-Identifier: Apache-2.0
/**
 * The effects of the WebGL backend: the EffectComposer passes of three.js (postTypes.ts gives the order).
 * The document core loads this module as a lazy chunk when the scene enables an effect. The passes run in the main
 * thread and in the generic scene worker: SMAA takes its textures from `createImageBitmap` (smaaPassGl.ts).
 *
 * The scene pass draws into a half-float target, so the materials give linear colours, and `OutputPass` applies the
 * tone mapping, the exposure and the sRGB output of the renderer. The background colour then goes through the tone
 * mapping too. The WebGPU pipeline does the same, so the two backends agree.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Object3D, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { denoiseNoise } from "./postNoise";
import { HIDDEN_EDGE_SHARE, type PostFactory, type PostPipeline, type PostSettings } from "./postTypes";
import { SmaaPassGl, smaaImages } from "./smaaPassGl";

/** The samples of the scene target for `msaa`. */
const MSAA_SAMPLES = 4;

/** The outline pass with the colour, the thickness and the strength of the settings. */
function outlinePass(
  outline: NonNullable<PostSettings["outline"]>,
  size: Vector2,
  ...args: [ConstructorParameters<typeof OutlinePass>[1], ConstructorParameters<typeof OutlinePass>[2]]
): OutlinePass {
  const pass = new OutlinePass(size, ...args);
  const [r, g, b] = outline.colour;
  pass.visibleEdgeColor.setRGB(r, g, b);
  pass.hiddenEdgeColor.setRGB(r * HIDDEN_EDGE_SHARE, g * HIDDEN_EDGE_SHARE, b * HIDDEN_EDGE_SHARE);
  pass.edgeStrength = outline.strength;
  pass.edgeThickness = outline.thickness;
  pass.edgeGlow = 0;
  pass.pulsePeriod = 0;
  return pass;
}

/** The GTAO pass with the radius and the intensity of the settings, and the seeded noise of its denoise. */
function gtaoPass(
  ao: NonNullable<PostSettings["ao"]>,
  size: Vector2,
  ...args: [ConstructorParameters<typeof GTAOPass>[0], ConstructorParameters<typeof GTAOPass>[1]]
): GTAOPass {
  const pass = new GTAOPass(...args, size.x, size.y);
  pass.updateGtaoMaterial({ radius: ao.radius });
  pass.blendIntensity = ao.intensity;
  // The noise of three.js comes from Math.random, so each page draws a different frame (postNoise.ts).
  const noise = pass.pdMaterial.uniforms.tNoise;
  if (noise === undefined) throw new Error("the denoise shader of GTAOPass has no noise texture");
  pass.pdNoiseTexture.dispose();
  pass.pdNoiseTexture = denoiseNoise();
  noise.value = pass.pdNoiseTexture;
  return pass;
}

/** The WebGL pipeline of the effects of `settings`. */
export const createWebGLPost: PostFactory = async (renderer, scene, camera, settings) => {
  const gl = renderer as unknown as WebGLRenderer;
  const size = gl.getSize(new Vector2());
  // SMAA decodes its textures first (one time per thread).
  const smaa = settings.antialias === "smaa" ? new SmaaPassGl(await smaaImages()) : null;
  const target = new WebGLRenderTarget(size.x, size.y, {
    type: HalfFloatType,
    samples: settings.antialias === "msaa" ? MSAA_SAMPLES : 0,
  });
  const composer = new EffectComposer(gl, target);
  composer.addPass(new RenderPass(scene, camera));
  if (settings.ao !== null) composer.addPass(gtaoPass(settings.ao, size, scene, camera));
  if (settings.bloom !== null) {
    const { strength, radius, threshold } = settings.bloom;
    composer.addPass(new UnrealBloomPass(size.clone(), strength, radius, threshold));
  }
  const outline = settings.outline === null ? null : outlinePass(settings.outline, size.clone(), scene, camera);
  if (outline !== null) composer.addPass(outline);
  if (smaa !== null) composer.addPass(smaa);
  composer.addPass(new OutputPass());
  if (settings.antialias === "fxaa") composer.addPass(new FXAAPass());
  return new WebGLPost(gl, composer, outline);
};

/** The composer of the effects; it follows the size and the pixel ratio of the renderer. */
class WebGLPost implements PostPipeline {
  readonly #size = new Vector2(-1, -1);
  #ratio = -1;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly composer: EffectComposer,
    private readonly outline: OutlinePass | null,
  ) {}

  render(selected: readonly Object3D[]): void {
    const size = this.renderer.getSize(new Vector2());
    const ratio = this.renderer.getPixelRatio();
    if (!size.equals(this.#size) || ratio !== this.#ratio) {
      this.#size.copy(size);
      this.#ratio = ratio;
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(size.x, size.y);
    }
    if (this.outline !== null) this.outline.selectedObjects = [...selected];
    // The draw calls and the triangles of the stats count all passes of the frame, not only the last pass.
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    try {
      // A delta of 0: no pass of the pipeline moves with the time, so a frame is a function of its inputs.
      this.composer.render(0);
    } finally {
      info.autoReset = true;
    }
  }

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
  }
}
