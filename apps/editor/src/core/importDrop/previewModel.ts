// SPDX-License-Identifier: Apache-2.0
/**
 * The lazy load of the preview loaders of the import by drop. `@scenity/runtime-dev/previewLoad` has the three.js
 * loaders and makes the plain meshes of the core. The lab page loads it only when a file comes.
 */
import type { PreviewFormat, PreviewModel } from "@scenity/runtime-dev";
import type { Vec3 } from "@scenity/character";

/** The preview model of the bytes of a file at a point (the loaders load at the first call). */
export async function loadPreview(
  bytes: ArrayBuffer,
  info: { readonly id: string; readonly name: string; readonly at: Vec3; readonly format: PreviewFormat },
): Promise<PreviewModel & { readonly scale: number; readonly triangles: number }> {
  const { loadObject, previewModel } = await import("@scenity/runtime-dev/previewLoad");
  return previewModel(await loadObject(bytes, info.name), info);
}
