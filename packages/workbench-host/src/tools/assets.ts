// SPDX-License-Identifier: Apache-2.0
/**
 * The asset tools of the workbench: the asset database of the open project
 * (`@scenity/assets`) with no browser.
 *
 * - `asset_search`: the assets of the project by words (the ID, the name of the source file, a tag, the kind), with
 *   the source, the record, the tags, the users ("used by") and the problems of each.
 * - `asset_import`: a model or texture file of the checkout becomes a project asset through `importProjectFile` of
 *   `@scenity/assets/projectImport` (the steps of the asset browser and of the promote): the source in
 *   `assets/sources`, the record, the import and the rights record `rights/imports.yaml`, so the release gate stops
 *   the asset until the owner records its rights. A viewer cannot import. The tool writes no scene: `entity.add` of
 *   `scene_command` puts the asset into the scene.
 *
 * The host loads `@scenity/assets` on demand, so a host that never reads the assets does not load it.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { isDenied } from "../denylist";
import type { ToolContext } from "./context";
import { cut, defineTool, errorResult, textResult } from "./kit";

/** The largest file that `asset_import` reads (bytes). */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

/** The parts of an asset entry that the tools show. */
interface ShownEntry {
  readonly id: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly sourcePath: string;
  readonly recordPath: string;
}

/** The project folder of a tool context. */
function projectOf(ctx: ToolContext): string {
  return ctx.projectDir ?? ctx.checkout;
}

/** The words of a search hit: the ID, the source name, the tags and the kind, in lower case. */
function wordsOf(entry: ShownEntry): string {
  return [entry.id, basename(entry.sourcePath), entry.kind, ...entry.tags].join(" ").toLowerCase();
}

export const assetSearch = defineTool({
  name: "asset_search",
  description:
    "Search the assets of the open project (the asset database): each asset with its ID, kind, tags, source file, " +
    "record and the documents that use it. Every word of `q` must match the ID, the source file name, a tag or the " +
    "kind. No words list every asset (at most `limit`).",
  input: z.object({
    q: z.string().optional().describe("Search words, for example 'lantern' or 'model imported'."),
    kind: z.string().min(1).optional().describe("Only assets of this kind, for example 'model' or 'texture'."),
    limit: z.number().int().min(1).max(200).optional().describe("The most assets in the result (default 30)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const { AssetDatabase } = await import("../../../assets/src/database");
    const db = await AssetDatabase.open(projectOf(ctx));
    const words = (input.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const found = db
      .entries()
      .filter((entry) => input.kind === undefined || entry.kind === input.kind)
      .filter((entry) => words.every((word) => wordsOf(entry).includes(word)));
    const line = (entry: ShownEntry): string => {
      const uses = db
        .usedBy(entry.id)
        .map((use) => (use.entity === undefined ? use.document : `${use.document}#${use.entity}`));
      const problems = db.problems().filter((problem) => problem.id === entry.id);
      const tags = entry.tags.length === 0 ? "" : ` · tags ${entry.tags.join(", ")}`;
      return [
        `asset:${entry.id} (${entry.kind})${tags} · source ${entry.sourcePath} · record ${entry.recordPath}`,
        `    used by ${uses.length === 0 ? "nothing" : uses.join(", ")}`,
        ...problems.map((problem) => `    problem: ${problem.message}`),
      ].join("\n");
    };
    const head = `${String(found.length)} of ${String(db.entries().length)} assets match.`;
    return textResult([head, ...cut(found, input.limit ?? 30, line, "give more words or a limit")]);
  },
});

/** The real path of a file of the checkout or of the project, or the reason that the tool refuses it. */
function importPath(ctx: ToolContext, file: string): { path: string } | { refusal: string } {
  const root = realpathSync(ctx.checkout);
  const full = isAbsolute(file) ? file : resolve(projectOf(ctx), file);
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return { refusal: `No file ${file}.` };
  }
  const near = relative(root, real);
  if (near.startsWith("..") || isAbsolute(near)) return { refusal: `${file} is not in the checkout.` };
  if (isDenied(near.split(sep).join("/"))) return { refusal: `${file} is on the denylist of the host.` };
  if (!statSync(real).isFile()) return { refusal: `${file} is not a file.` };
  if (statSync(real).size > MAX_IMPORT_BYTES) return { refusal: `${file} is larger than 256 MB.` };
  return { path: real };
}

export const assetImport = defineTool({
  name: "asset_import",
  description:
    "Import a model or texture file of the checkout into the open project as an asset (as the asset browser does): " +
    "the source in assets/sources, its record, the import and the rights record. The release gate stops the asset " +
    "until the owner records its rights. Then entity.add of scene_command puts it into the scene.",
  input: z.object({
    file: z.string().min(1).describe("The file: a path in the project folder, or an absolute path in the checkout."),
    name: z.string().min(1).optional().describe("The file name in the project (default: the name of the file)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    if (ctx.role === "viewer") return errorResult("asset_import: the role viewer cannot import assets.");
    const found = importPath(ctx, input.file);
    if ("refusal" in found) return errorResult(`asset_import: ${found.refusal}`);
    const { importProjectFile } = await import("../../../assets/src/projectImport");
    const bytes = new Uint8Array(readFileSync(found.path));
    const result = await importProjectFile(projectOf(ctx), input.name ?? basename(found.path), bytes, {
      bound: realpathSync(ctx.checkout),
    });
    if (!result.ok) return errorResult(`asset_import: ${result.reason}.`);
    const { entry, rights, warnings } = result;
    return textResult([
      `Imported asset:${entry.id} (${entry.kind}) · source ${result.source} · record ${result.record}.`,
      rights.note,
      ...warnings.map((warning) => `Warning: ${warning}`),
      `Next: scene_command entity.add with asset 'asset:${entry.id}' puts it into the open scene.`,
    ]);
  },
});
