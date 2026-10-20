// SPDX-License-Identifier: Apache-2.0
/**
 * The host face of the demo plugin (docs/studio-plugins.md). It has these parts:
 *
 * - The asset source "Demo patterns" with two textures of this plugin (`patterns/`, CC0, made for this sample). The
 *   studio lists it in Get assets of the Project panel: a search, a preview, and an import with the rights record of
 *   the source.
 * - The publish target "The published folder" copies the archive of a publish into `published/` of the project.
 * - The tool `demo_spin_time`. The agents and the search box of the editor window run it.
 * - The importer `demo.pattern` makes an asset of the kind `demo.pattern` from a `.pattern` file.
 *
 * The empty fields are the parts of a host face that the workbench host reads.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

/** The patterns of the plugin: the ID and the tags of each one. */
const PATTERNS = [
  { id: "checker", name: "Checker", tags: ["pattern", "checker", "orange"] },
  { id: "stripes", name: "Stripes", tags: ["pattern", "stripes", "blue"] },
] as const;

const fileOf = (id: string): string => fileURLToPath(new URL(`../patterns/${id}.png`, import.meta.url));

/** The asset source of the patterns (the `AssetProvider` of `@scenity/assets`). */
const patterns = {
  id: "demo-patterns",
  name: "Demo patterns",
  kinds: ["texture"] as const,
  rights: {
    name: "demo-patterns",
    source: "The patterns of the demo plugin of the spin sample of Scenity",
    author: "Scenity",
    licence: "CC0 1.0 Universal (public domain dedication)",
    spdx: "CC0-1.0",
    allowedUse: ["web"],
    webDelivery: true,
  },
  search: (kind: string, text: string) => {
    const words = text.toLowerCase();
    return Promise.resolve(
      kind !== "texture"
        ? []
        : PATTERNS.filter(
            (item) => words === "" || item.id.includes(words) || item.tags.some((tag) => tag.includes(words)),
          ).map((item) => ({
            ...item,
            tags: [...item.tags],
            kind: "texture" as const,
            licence: "CC0-1.0",
            authors: ["Scenity"],
          })),
    );
  },
  preview: (id: string) => pathToFileURL(fileOf(id)).href,
  files: (id: string) => Promise.resolve([{ path: `${id}.png`, url: pathToFileURL(fileOf(id)).href }]),
};

/** The publish target: a copy of the archive in the folder `published/` of the project. */
const publishedFolder = {
  id: "demo.published",
  title: "The published folder",
  publish: (input: { readonly zip: string; readonly dir: string }) => {
    const folder = join(input.dir, "published");
    mkdirSync(folder, { recursive: true });
    copyFileSync(input.zip, join(folder, basename(input.zip)));
    return Promise.resolve(`Copied to published/${basename(input.zip)}.`);
  },
};

/** A tool of the plugin (the `ToolDef` of `@scenity/agent-tools`): the time of one turn of a spinner. */
const spinTime = {
  name: "demo_spin_time",
  description: "The time of one turn of a spinner of the component demo.spin at a speed (degrees per second).",
  input: z.object({ speed: z.number().min(1).max(3600).describe("The speed in degrees per second") }),
  alwaysLoad: false,
  handler: (input: { readonly speed: number }) =>
    Promise.resolve({
      content: [
        {
          type: "text" as const,
          text: `A spinner at ${String(input.speed)} deg/s turns once in ${String(Math.round((360 / input.speed) * 100) / 100)} s.`,
        },
      ],
    }),
};

/** The settings of the importer of the patterns: the scale of the pattern. */
const patternSettings = z.object({ scale: z.number().min(0.1).max(10).default(1) });

/**
 * An importer of the plugin (the `Importer` of `@scenity/assets/import`): a `.pattern` file (the JSON of a pattern:
 * its colours and its size) is an asset of the kind `demo.pattern`. The import writes `pattern.json` with the scale of
 * the settings. The asset inspector shows it with the preview of the kind.
 */
const patternImporter = {
  name: "demo.pattern",
  version: 1,
  extensions: [".pattern"],
  kinds: ["demo.pattern"],
  schema: patternSettings,
  parseSettings: (raw: unknown) => {
    const parsed = patternSettings.safeParse(raw ?? {});
    if (parsed.success) return { ok: true as const, settings: parsed.data };
    const errors = parsed.error.issues.map((issue) => ({
      path: `/settings/${issue.path.join("/")}`,
      message: issue.message,
    }));
    return { ok: false as const, errors };
  },
  run: (context: { readonly source: string; readonly outDir: string; readonly settings: Record<string, unknown> }) => {
    const pattern = JSON.parse(readFileSync(context.source, "utf8")) as { colours?: unknown };
    const colours = Array.isArray(pattern.colours) ? pattern.colours.length : 0;
    writeFileSync(join(context.outDir, "pattern.json"), JSON.stringify({ ...pattern, scale: context.settings.scale }));
    const warnings = colours === 0 ? ["The pattern has no colours."] : [];
    return Promise.resolve({ files: ["pattern.json"], warnings, report: { colours } });
  },
};

export default {
  id: "demo",
  // The asset sources of the plugin.
  assetSources: [patterns],
  publishTargets: [publishedFolder],
  // The importers of the plugin.
  importers: [patternImporter],
  // The parts that the workbench host reads: the tool, and no context lines, runs or paths.
  tools: [spinTime],
  contextLines: {},
  runs: { commands: {} },
  paths: {},
};
