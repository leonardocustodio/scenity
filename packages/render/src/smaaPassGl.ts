// SPDX-License-Identifier: Apache-2.0
// Parts of this file come from three.js (MIT licence, copyright 2010-2026 three.js authors). See NOTICE.
/**
 * The SMAA pass of the WebGL effects. It is the `SMAAPass` of three.js with one change: the area and search
 * textures come from `createImageBitmap`, not from an `Image` element. A worker has no `Image`, and the generic scene
 * worker draws WebGL. The pass reads the PNG data of the textures from the prototype of `SMAAPass`, so the data stays
 * the data of three.js. A Blob and `createImageBitmap` need no `connect-src` and no `eval` under the CSP.
 */
import {
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { SMAABlendShader, SMAAEdgesShader, SMAAWeightsShader } from "three/examples/jsm/shaders/SMAAShader.js";

/** The methods of `SMAAPass` that give the PNG data URLs of its textures (the types of three.js do not give them). */
interface SmaaData {
  _getAreaTexture(): string;
  _getSearchTexture(): string;
}

/** The area and search textures of SMAA. */
export interface SmaaImages {
  readonly area: ImageBitmap;
  readonly search: ImageBitmap;
}

/** Decode a PNG data URL with no Image element and no colour change. */
async function bitmapOf(dataUrl: string): Promise<ImageBitmap> {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/png" });
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

let images: Promise<SmaaImages> | null = null;

/** The SMAA textures as image bitmaps. The thread decodes them one time. */
export function smaaImages(): Promise<SmaaImages> {
  const data = SMAAPass.prototype as unknown as SmaaData;
  images ??= Promise.all([bitmapOf(data._getAreaTexture()), bitmapOf(data._getSearchTexture())]).then(
    ([area, search]) => ({ area, search }),
  );
  return images;
}

/** A texture of a bitmap with the filters of `SMAAPass`. */
function smaaTexture(image: ImageBitmap, name: string, filter: typeof LinearFilter | typeof NearestFilter): Texture {
  const texture = new Texture(image);
  texture.name = name;
  texture.minFilter = filter;
  texture.magFilter = filter === NearestFilter ? NearestFilter : texture.magFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** A material of an SMAA shader with a copy of its uniforms. */
function smaaMaterial(shader: {
  readonly defines?: Record<string, unknown>;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly vertexShader: string;
  readonly fragmentShader: string;
}): ShaderMaterial {
  return new ShaderMaterial({
    defines: { ...shader.defines },
    uniforms: UniformsUtils.clone(shader.uniforms),
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });
}

/** Set the value of a uniform of a material. Each SMAA shader declares the uniforms that the pass sets. */
function setUniform(material: ShaderMaterial, name: string, value: unknown): void {
  const uniform = material.uniforms[name];
  if (uniform === undefined) throw new Error(`the SMAA shader has no uniform ${name}`);
  uniform.value = value;
}

/** The SMAA pass: edges, weights, then the blend of the input with the weights. */
export class SmaaPassGl extends Pass {
  readonly #edges = new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType });
  readonly #weights = new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType });
  readonly #area: Texture;
  readonly #search: Texture;
  readonly #edgesMaterial = smaaMaterial(SMAAEdgesShader);
  readonly #weightsMaterial = smaaMaterial(SMAAWeightsShader);
  readonly #blendMaterial = smaaMaterial(SMAABlendShader);
  readonly #quad = new FullScreenQuad();

  constructor(textures: SmaaImages) {
    super();
    this.#area = smaaTexture(textures.area, "SMAAPass.area", LinearFilter);
    this.#search = smaaTexture(textures.search, "SMAAPass.search", NearestFilter);
    setUniform(this.#weightsMaterial, "tDiffuse", this.#edges.texture);
    setUniform(this.#weightsMaterial, "tArea", this.#area);
    setUniform(this.#weightsMaterial, "tSearch", this.#search);
    setUniform(this.#blendMaterial, "tDiffuse", this.#weights.texture);
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    setUniform(this.#edgesMaterial, "tDiffuse", readBuffer.texture);
    this.#draw(renderer, this.#edgesMaterial, this.#edges);
    this.#draw(renderer, this.#weightsMaterial, this.#weights);
    setUniform(this.#blendMaterial, "tColor", readBuffer.texture);
    this.#draw(renderer, this.#blendMaterial, this.renderToScreen ? null : writeBuffer);
  }

  override setSize(width: number, height: number): void {
    this.#edges.setSize(width, height);
    this.#weights.setSize(width, height);
    for (const material of [this.#edgesMaterial, this.#weightsMaterial, this.#blendMaterial]) {
      (material.uniforms.resolution?.value as { set(x: number, y: number): void } | undefined)?.set(
        1 / width,
        1 / height,
      );
    }
  }

  override dispose(): void {
    this.#edges.dispose();
    this.#weights.dispose();
    this.#area.dispose();
    this.#search.dispose();
    this.#edgesMaterial.dispose();
    this.#weightsMaterial.dispose();
    this.#blendMaterial.dispose();
    this.#quad.dispose();
  }

  /** Draw the quad with a material into a target (null: the canvas). */
  #draw(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.#quad.material = material;
    renderer.setRenderTarget(target);
    if (this.clear) renderer.clear();
    this.#quad.render(renderer);
  }
}
