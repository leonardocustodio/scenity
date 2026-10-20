// SPDX-License-Identifier: Apache-2.0
/**
 * The render options of the scene page: the quality tier, the backend, the render worker, the GPU timer, the origin of
 * the assets and the audio. The URL parameters give these options. In the edit mode, the render group of the editor
 * settings (Preferences) gives each option that the URL does not give. A URL parameter has priority. A page with no
 * edit mode (the gallery, an embed) reads only its URL, so its frames do not change.
 */
import type { EditorSettings } from "@scenity/editor-core";
import { pageSettings } from "./pageSettings";

/** The URL parameters of the page with the render settings for each option that the URL does not give. */
export function renderParams(
  params: URLSearchParams,
  render: EditorSettings["render"] = pageSettings().value.render,
): URLSearchParams {
  if (params.get("edit") !== "1") return params;
  const out = new URLSearchParams(params);
  const fill = (key: string, value: string | null): void => {
    if (!out.has(key) && value !== null) out.set(key, value);
  };
  fill("tier", render.tier === "high" ? null : render.tier);
  fill("backend", render.backend === "webgpu" ? "webgpu" : null);
  fill("worker", render.worker ? null : "0");
  fill("gpu", render.gpuTimer ? "1" : null);
  fill("assets", render.assets === "auto" ? null : render.assets);
  fill("audio", render.audio ? null : "0");
  return out;
}
