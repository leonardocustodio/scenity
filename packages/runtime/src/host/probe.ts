// SPDX-License-Identifier: Apache-2.0
/**
 * The GPU probe of the 3D scene. It runs before the 3D chunk loads. It checks for a WebGL 2 context with
 * `failIfMajorPerformanceCaveat` and a renderer that is not a software rasterizer. It also gives a first quality tier
 * from the renderer class and the device memory. The render loop adapts the tier later.
 */
import type { Tier } from "../protocol";

export type ProbeFailure = "no_canvas" | "no_webgl2" | "software";

export interface ProbeResult {
  readonly ok: boolean;
  readonly reason: ProbeFailure | null;
  /** The (unmasked, where the browser gives it) renderer string, or null. */
  readonly renderer: string | null;
  readonly tier: Tier;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;

/** True for a software rasterizer: it is too slow for the scene (a measurement gave 6.5–27 fps). */
export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE.test(renderer);
}

/**
 * The first tier of a renderer string. Discrete and Apple silicon GPUs start at high. Recent integrated GPUs start at
 * medium. Older integrated and mobile GPUs start at low. A small device memory caps the tier.
 */
export function classifyRenderer(renderer: string, deviceMemory: number | null): Tier {
  let tier: Tier = "medium";
  if (/apple m\d|apple gpu|nvidia|geforce|quadro|rtx|radeon rx|radeon pro|intel\(r\) arc|\barc a\d/i.test(renderer)) {
    tier = "high";
  } else if (
    /iris xe|iris\(r\) xe|radeon\(tm\) graphics|radeon graphics|adreno \(tm\) 7|adreno 7|mali-g7/i.test(renderer)
  ) {
    tier = "medium";
  } else if (/intel.*(uhd|hd graphics)|mali|adreno|powervr|videocore/i.test(renderer)) {
    tier = "low";
  }
  if (deviceMemory !== null && deviceMemory <= 4) return "low";
  if (deviceMemory !== null && deviceMemory <= 8 && tier === "high" && !/apple/i.test(renderer)) return "medium";
  return tier;
}

/** The fields of `GPUAdapterInfo` that classifyAdapter reads. */
export interface AdapterNames {
  readonly vendor: string;
  readonly architecture: string;
  readonly description: string;
}

/**
 * The GPU names of classifyRenderer for the vendor and the architecture of a WebGPU adapter. The adapter gives
 * no renderer string, so the table gives the name of a GPU of that family.
 */
const ADAPTER_FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^apple/, "Apple GPU"],
  [/^nvidia/, "NVIDIA"],
  [/^intel xe-hp|^intel xe2|^intel arc/, "Intel(R) Arc"],
  [/^intel (gen-12|xe)/, "Intel Iris Xe"],
  [/^intel/, "Intel HD Graphics"],
  [/^amd/, "AMD Radeon Graphics"],
  [/^qualcomm adreno-7/, "Adreno 7"],
  [/^qualcomm/, "Adreno"],
  [/^arm (valhall|5th-gen)/, "Mali-G7"],
  [/^arm/, "Mali"],
  [/^imagination/, "PowerVR"],
];

/**
 * The first tier of a WebGPU adapter: the rules of classifyRenderer on the
 * description of the adapter (some browsers give the GPU name there) and on the GPU family of its vendor and
 * architecture. A texture limit under 8192 px caps the tier at medium.
 */
export function classifyAdapter(names: AdapterNames, maxTexture: number | null, deviceMemory: number | null): Tier {
  const family = `${names.vendor} ${names.architecture}`.toLowerCase();
  const known = ADAPTER_FAMILIES.find(([pattern]) => pattern.test(family))?.[1] ?? "";
  const tier = classifyRenderer(`${names.description} ${known}`, deviceMemory);
  return tier === "high" && maxTexture !== null && maxTexture < 8192 ? "medium" : tier;
}

interface DebugRendererInfo {
  readonly UNMASKED_RENDERER_WEBGL: number;
}

/** Probe the GPU. `allowSoftware` lets the tests run the scene on a software rasterizer. */
export function probeGpu(options: { readonly allowSoftware?: boolean } = {}): ProbeResult {
  const allowSoftware = options.allowSoftware === true;
  if (typeof document === "undefined") return { ok: false, reason: "no_canvas", renderer: null, tier: "low" };
  const canvas = document.createElement("canvas");
  let gl: WebGL2RenderingContext | null;
  try {
    gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: !allowSoftware, powerPreference: "default" });
  } catch {
    gl = null;
  }
  if (gl === null) return { ok: false, reason: "no_webgl2", renderer: null, tier: "low" };
  const info = gl.getExtension("WEBGL_debug_renderer_info") as DebugRendererInfo | null;
  const raw: unknown = info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  const renderer = typeof raw === "string" ? raw : null;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  if (renderer !== null && isSoftwareRenderer(renderer) && !allowSoftware) {
    return { ok: false, reason: "software", renderer, tier: "low" };
  }
  const memory = (navigator as { deviceMemory?: unknown }).deviceMemory;
  const tier = classifyRenderer(renderer ?? "", typeof memory === "number" ? memory : null);
  return { ok: true, reason: null, renderer, tier: renderer !== null && isSoftwareRenderer(renderer) ? "low" : tier };
}
