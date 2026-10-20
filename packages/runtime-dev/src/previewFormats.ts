// SPDX-License-Identifier: Apache-2.0
/**
 * The file types of the import by drop: plain functions without three.js, so the lab page reads them before it loads
 * the preview loaders (previewLoad.ts).
 */

/** The file types that the lab page previews without the host (a .blend file needs Blender). */
export const PREVIEW_FORMATS = [".glb", ".gltf", ".obj", ".fbx"] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];
/** The file types of an import (the host reads the .blend file with Blender). */
export const IMPORT_FORMATS = [...PREVIEW_FORMATS, ".blend"] as const;

/** The lowercase extension of a file name, with its dot, or "". */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at).toLowerCase();
}

/** The preview format of a file name, or null. */
export function previewFormat(name: string): PreviewFormat | null {
  const ext = extensionOf(name);
  return (PREVIEW_FORMATS as readonly string[]).includes(ext) ? (ext as PreviewFormat) : null;
}
