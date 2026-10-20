// SPDX-License-Identifier: Apache-2.0
/**
 * The showroom template of `scenity create`.
 *
 * The CLI package holds the documents of `samples/showroom` in `templates/showroom`: the project, the scenes, the asset
 * records, the rights record, the stills and the poster. The template holds no build output: `scenity build` writes
 * the asset build again. The CC0 source files of the assets are not in the package. The file `sources.json` gives
 * the URL of each source file at Poly Haven, with its size and its SHA-256 hash.
 *
 * A create copies the source files from the sample of a checkout when the hash agrees, else it downloads them. A
 * file with another size or hash stops the create. `bun tools/showroom-template.ts` writes the template from the
 * sample, and `--check` tells when the template is not current.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PROJECT_FILE } from "@scenity/scene";

/** The folder of the showroom template in the CLI package. */
export const SHOWROOM_TEMPLATE_DIR = join(import.meta.dir, "..", "..", "templates", "showroom");
/** The list of the source files of a template, in the template folder. */
export const SOURCES_FILE = "sources.json";
export const SOURCES_FORMAT = "scenity.template-sources/1";

/** One source file of a template: its path in the project, its URL, its size and its SHA-256 hash (hex). */
export interface TemplateSource {
  readonly path: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The content of `sources.json`. */
export interface TemplateSources {
  readonly format: typeof SOURCES_FORMAT;
  /** The rights record of the source files, relative to the project folder. */
  readonly rights: string;
  readonly files: readonly TemplateSource[];
}

/** The folders that a template skips: the outputs and the state of the tools. */
export const TEMPLATE_SKIPPED: ReadonlySet<string> = new Set([
  "dist",
  "node_modules",
  ".scenity",
  "test-results",
  ".git",
]);

/** The SHA-256 hash of bytes (hex). */
export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Each file of a folder, relative to it with "/", in path order. `skip` is true for a relative path that the list
 * skips. */
export function folderFiles(dir: string, skip: (path: string) => boolean, folder = dir): string[] {
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const path = join(folder, name);
      const rel = relative(dir, path).split(sep).join("/");
      if (TEMPLATE_SKIPPED.has(name) || skip(rel)) return [];
      return statSync(path).isDirectory() ? folderFiles(dir, skip, path) : [rel];
    });
}

/** True when a value of `sources.json` is a source entry with a safe path and an HTTPS URL. */
function isSource(value: unknown): value is TemplateSource {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.path === "string" &&
    !file.path.split("/").includes("..") &&
    typeof file.url === "string" &&
    file.url.startsWith("https://") &&
    Number.isInteger(file.bytes) &&
    typeof file.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(file.sha256)
  );
}

/** Read and check `sources.json` of a template folder. Throws on a bad list. */
export function readSources(templateDir: string): TemplateSources {
  const data = JSON.parse(readFileSync(join(templateDir, SOURCES_FILE), "utf8")) as Record<string, unknown>;
  const files: unknown[] = Array.isArray(data.files) ? data.files : [];
  if (data.format !== SOURCES_FORMAT || typeof data.rights !== "string" || !files.every(isSource)) {
    throw new Error(`${join(templateDir, SOURCES_FILE)} is not a ${SOURCES_FORMAT} list.`);
  }
  return { format: SOURCES_FORMAT, rights: data.rights, files };
}

/** The document files of a template folder (each file except `sources.json`): the path → the bytes. */
export function templateDocuments(templateDir: string): Map<string, Uint8Array> {
  if (!existsSync(join(templateDir, PROJECT_FILE))) throw new Error(`${templateDir} has no ${PROJECT_FILE}.`);
  const files = new Map<string, Uint8Array>();
  for (const path of folderFiles(templateDir, (rel) => rel === SOURCES_FILE)) {
    files.set(path, readFileSync(join(templateDir, ...path.split("/"))));
  }
  return files;
}

/** The function that downloads one file. */
export type FetchFile = (url: string) => Promise<Uint8Array>;

/** Download a file with `fetch`. Throws on an HTTP failure. */
export async function fetchFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} gave HTTP ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** How a create got the source files of a template. */
export interface SourceFiles {
  readonly files: Map<string, Uint8Array>;
  readonly copied: number;
  readonly downloaded: number;
}

/** The number of downloads at the same time. */
const DOWNLOADS = 6;

/** The bytes of one source file: the file of the sample when the hash agrees, else a download with a check. */
async function sourceFile(
  source: TemplateSource,
  sampleDir: string | null,
  download: FetchFile,
  log: (text: string) => void,
): Promise<{ data: Uint8Array; copied: boolean }> {
  const local = sampleDir === null ? null : join(sampleDir, ...source.path.split("/"));
  if (local !== null && existsSync(local)) {
    const data = readFileSync(local);
    if (sha256(data) === source.sha256) return { data, copied: true };
  }
  log(`scenity create: download ${source.url}`);
  const data = await download(source.url);
  if (data.byteLength !== source.bytes || sha256(data) !== source.sha256) {
    throw new Error(`${source.url} gave other bytes than ${source.path} of the template (size or SHA-256).`);
  }
  return { data, copied: false };
}

/**
 * The source files of a template: a copy from `sampleDir` (the sample of a checkout) when the hash agrees, else a
 * download (six at a time). Throws when a file has another size or hash.
 */
export async function sourceFiles(
  sources: TemplateSources,
  sampleDir: string | null,
  download: FetchFile = fetchFile,
  log: (text: string) => void = () => undefined,
): Promise<SourceFiles> {
  const results: { data: Uint8Array; copied: boolean }[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < sources.files.length; index = next++) {
      const source = sources.files[index];
      if (source !== undefined) results[index] = await sourceFile(source, sampleDir, download, log);
    }
  };
  await Promise.all(Array.from({ length: DOWNLOADS }, worker));
  const files = new Map(sources.files.map((source, index) => [source.path, results[index]?.data ?? new Uint8Array()]));
  const copied = results.filter((result) => result.copied).length;
  return { files, copied, downloaded: sources.files.length - copied };
}
