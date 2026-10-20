// SPDX-License-Identifier: Apache-2.0
// The importer registry, the import settings and the header read of a texture.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { recipeSpec } from "../src/import/blenderPaths";
import { defineImporter, extensionOf, ImporterRegistry, isImporter } from "../src/import/registry";
import { defaultImporterRegistry, importerRegistryWith } from "../src/import/run";
import { modelImportSettingsSchema, needsRecipe, textureImportSettingsSchema } from "../src/import/settings";
import { readTextureInfo, sniffTextureInfo } from "../src/import/textureInfo";
import { jsonSchemaFiles } from "../src/jsonSchema";
import { IMPORT_FIXTURES } from "./importHelpers";

describe("the importer registry", () => {
  test("the default registry reads each built-in format by extension", () => {
    const registry = defaultImporterRegistry();
    expect(registry.extensions()).toEqual([
      ".avif",
      ".blend",
      ".fbx",
      ".glb",
      ".gltf",
      ".hdr",
      ".jpeg",
      ".jpg",
      ".material.json",
      ".mp3",
      ".obj",
      ".oga",
      ".ogg",
      ".opus",
      ".png",
      ".wav",
      ".webp",
    ]);
    expect(registry.forFile("a/Chair.GLB")?.name).toBe("glb");
    expect(registry.forFile("photo.jpeg")?.name).toBe("jpeg");
    expect(registry.forFile(".fbx")?.name).toBe("fbx");
    expect(registry.forFile("model.stl")).toBeUndefined();
    expect(registry.get("hdr")?.kinds[0]).toBe("environment");
  });

  test("a plugin importer adds an extension; a second importer of a name or an extension throws", () => {
    const registry = defaultImporterRegistry();
    const plugin = defineImporter({
      name: "acme.ply",
      version: 1,
      extensions: [".ply"],
      kinds: ["model"],
      schema: z.strictObject({}),
      run: () => Promise.resolve({ files: [], warnings: [], report: {} }),
    });
    registry.register(plugin);
    expect(registry.forFile("scan.ply")?.name).toBe("acme.ply");
    expect(() => registry.register(plugin)).toThrow("registered already");
    expect(() => new ImporterRegistry([{ ...plugin, name: "acme.other" }, plugin])).toThrow(".ply has the importer");
  });

  test("extensionOf gives the last extension in lower case", () => {
    expect(extensionOf("a/b/Model.Tar.GLB")).toBe(".glb");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
  });
});

describe("the import settings", () => {
  test("an empty object gets the defaults", () => {
    expect(modelImportSettingsSchema.parse({})).toEqual({
      scale: "auto",
      up: "y",
      origin: "source",
      merge: false,
      maxTextureSize: 2048,
    });
    expect(textureImportSettingsSchema.parse({})).toEqual({
      role: "color",
      colorSpace: "srgb",
      maxSize: 2048,
      mipmaps: true,
    });
  });

  test("a bad setting gives an error with its JSON Pointer under /settings", () => {
    const parsed = defaultImporterRegistry()
      .get("fbx")
      ?.parseSettings({ scale: -1, up: "x", decimate: { ratio: 0.5, unsubdivide: 2 } });
    expect(parsed?.ok).toBe(false);
    if (parsed?.ok !== false) return;
    const paths = parsed.errors.map((error) => error.path);
    expect(paths).toContain("/settings/scale");
    expect(paths).toContain("/settings/up");
    expect(paths.some((path) => path.startsWith("/settings/decimate"))).toBe(true);
  });

  test("the fbx-prop recipe is a valid set of settings, and it needs the recipe path", () => {
    const settings = modelImportSettingsSchema.parse({
      origin: [0, 0.1, 0],
      scale: 0.01,
      decimate: [{ above: 5000, ratio: 0.4, smooth: true, objects: ["frame"] }],
      materials: { Metal: { color: "tex/metal_c.png", normal: "tex/metal_n.png", rma: "tex/metal_rma.png" } },
      bake: { size: 1024, keep: ["Screen"] },
      parts: { handle: { objects: ["Handle"], triangles: 800, pivot: [0, 0, 1] } },
      sockets: { display: { at: [0, -0.1, 1.2], size: [0.3, 0.2], tilt: 10 } },
    });
    expect(needsRecipe(settings)).toBe(true);
    const spec = recipeSpec(settings, "/abs/prop.fbx");
    expect(spec.format).toBe("fbx-prop");
    expect(spec.model).toBe("/abs/prop.fbx");
    expect(spec.origin).toEqual([0, 0.1, 0]);
    expect(spec.scale).toBe(0.01);
    expect(Object.keys(spec).sort()).toEqual(
      [
        "bake",
        "decimate",
        "format",
        "materials",
        "maxTextureSize",
        "model",
        "origin",
        "parts",
        "scale",
        "sockets",
      ].sort(),
    );
    expect(needsRecipe(modelImportSettingsSchema.parse({ decimate: 0.5, merge: true, origin: "base-centre" }))).toBe(
      false,
    );
  });

  test("the JSON Schema files are current", () => {
    for (const { file, text } of jsonSchemaFiles()) {
      expect(readFileSync(join(import.meta.dir, "..", "schema", file), "utf8")).toBe(text);
    }
  });
});

describe("the header read of a texture", () => {
  test("each texture fixture gives its format and its size (8 x 4 px)", () => {
    for (const [file, format] of [
      ["tile.png", "png"],
      ["tile.jpg", "jpeg"],
      ["tile.webp", "webp"],
      ["tile.avif", "avif"],
      ["sky.hdr", "hdr"],
    ] as const) {
      const bytes = readFileSync(join(IMPORT_FIXTURES, file));
      expect(readTextureInfo(bytes, format)).toMatchObject({ format, width: 8, height: 4 });
      expect(sniffTextureInfo(bytes)?.format).toBe(format);
    }
  });

  test("the bytes of another format give null", () => {
    const png = readFileSync(join(IMPORT_FIXTURES, "tile.png"));
    expect(readTextureInfo(png, "jpeg")).toBeNull();
    expect(readTextureInfo(new Uint8Array(4), "avif")).toBeNull();
    expect(sniffTextureInfo(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("the importers of the plugins", () => {
  const plugin = defineImporter({
    name: "acme.pattern",
    version: 1,
    extensions: [".pattern"],
    kinds: ["acme.pattern"],
    schema: z.object({ scale: z.number().default(1) }),
    run: () => Promise.resolve({ files: [], warnings: [], report: {} }),
  });

  test("join the built-in importers; a value that is not an importer and a clash go with a warning", () => {
    const warnings: string[] = [];
    const clash = { ...plugin, name: "acme.png", extensions: [".png"] };
    const registry = importerRegistryWith([plugin, { name: "half" }, clash], (text) => warnings.push(text));
    expect(registry.forFile("assets/rings.pattern")?.name).toBe("acme.pattern");
    expect(registry.forFile("a.png")?.name).not.toBe("acme.png");
    expect(registry.get("acme.png")).toBeUndefined();
    expect(warnings).toEqual([
      "a value of the importers of a plugin is not an importer",
      "the importer acme.png of a plugin: .png has the importer png already",
    ]);
    expect(isImporter(plugin)).toBe(true);
    expect(isImporter({ ...plugin, extensions: ["pattern"] })).toBe(false);
  });
});
