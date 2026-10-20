// SPDX-License-Identifier: Apache-2.0
/**
 * The texture importers: PNG, JPEG, WebP, AVIF and Radiance HDR. An import checks the header of the file
 * against its extension and copies the bytes into the output folder. The build encodes the texture for its role;
 * the import decodes no pixels.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { z } from "zod";
import { defineImporter, type ImportContext, type Importer, type ImporterResult } from "./registry";
import { environmentImportSettingsSchema, textureImportSettingsSchema } from "./settings";
import { readTextureInfo, type TextureFormat } from "./textureInfo";

/** The name of the main file of a texture import, by format. */
export const TEXTURE_FILES: Readonly<Record<TextureFormat, string>> = {
  png: "texture.png",
  jpeg: "texture.jpg",
  webp: "texture.webp",
  avif: "texture.avif",
  hdr: "environment.hdr",
};

function runTexture(context: ImportContext<{ readonly maxSize: number }>, format: TextureFormat): ImporterResult {
  const bytes = readFileSync(context.source);
  const info = readTextureInfo(bytes, format);
  if (info === null) throw new Error(`${basename(context.source)}: the header is not the header of a ${format} file`);
  const file = TEXTURE_FILES[format];
  writeFileSync(join(context.outDir, file), bytes);
  const warnings: string[] = [];
  const edge = Math.max(info.width, info.height);
  if (edge > context.settings.maxSize) {
    warnings.push(
      `${String(info.width)} × ${String(info.height)} px: the build scales it to ${String(context.settings.maxSize)} px`,
    );
  }
  return { files: [file], warnings, report: { ...info, bytes: bytes.byteLength } };
}

function textureImporter(
  name: string,
  format: TextureFormat,
  extensions: readonly string[],
  kinds: readonly string[],
  schema: z.ZodType<{ readonly maxSize: number }>,
): Importer {
  return defineImporter({
    name,
    version: 1,
    extensions,
    kinds,
    schema,
    run: (context) => Promise.resolve(runTexture(context, format)),
  });
}

/** The built-in texture importers: png, jpeg, webp, avif (textures) and hdr (environment maps). */
export function textureImporters(): Importer[] {
  const texture = ["texture"];
  return [
    textureImporter("png", "png", [".png"], texture, textureImportSettingsSchema),
    textureImporter("jpeg", "jpeg", [".jpg", ".jpeg"], texture, textureImportSettingsSchema),
    textureImporter("webp", "webp", [".webp"], texture, textureImportSettingsSchema),
    textureImporter("avif", "avif", [".avif"], texture, textureImportSettingsSchema),
    textureImporter("hdr", "hdr", [".hdr"], ["environment", "texture"], environmentImportSettingsSchema),
  ];
}
