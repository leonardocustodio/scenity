// SPDX-License-Identifier: Apache-2.0
/**
 * The showroom template of `scenity create` from `samples/showroom`.
 *
 * Run from the repo root:
 *     bun tools/showroom-template.ts            # write packages/cli/templates/showroom
 *     bun tools/showroom-template.ts --check    # exit 1 when the template is not current
 *
 * The template gets each file of the sample but the outputs (`dist`, the asset build of `build.assets.output`, the
 * state folders) and the source files under the asset roots. `sources.json` lists the source files with their size
 * and hash. The URL of a source file comes from the current `sources.json`: a new source file needs its URL there
 * (a CC0 file of the rights record), else the tool stops.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  folderFiles,
  readSources,
  sha256,
  SOURCES_FILE,
  SOURCES_FORMAT,
  type TemplateSource,
  type TemplateSources,
} from "../packages/cli/src/create/showroom";

const ROOT = resolve(import.meta.dir, "..");
export const SAMPLE_DIR = join(ROOT, "samples", "showroom");
export const TEMPLATE_DIR = join(ROOT, "packages", "cli", "templates", "showroom");
/** The rights record of the source files of the sample. */
const RIGHTS = "rights/polyhaven.yaml";

interface ProjectParts {
  readonly assets?: readonly string[];
  readonly build?: { readonly assets?: { readonly output?: string } };
}

/** The files of the template from a sample: the documents, the source list and the problems. */
export function templateFromSample(
  sampleDir: string,
  previous: TemplateSources | null,
): { files: Map<string, Uint8Array>; problems: string[] } {
  const project = JSON.parse(readFileSync(join(sampleDir, "scenity.project.json"), "utf8")) as ProjectParts;
  const roots = (project.assets ?? []).map((root) => root.replace(/\/$/, ""));
  const output = project.build?.assets?.output ?? "build";
  const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
  const isSource = (path: string): boolean => roots.some((root) => under(path, root)) && !path.endsWith(".meta.json");
  const all = folderFiles(sampleDir, (path) => under(path, output));
  const urls = new Map((previous?.files ?? []).map((file) => [file.path, file.url]));
  const files = new Map<string, Uint8Array>();
  const sources: TemplateSource[] = [];
  const problems: string[] = [];
  for (const path of all) {
    const data = readFileSync(join(sampleDir, ...path.split("/")));
    if (!isSource(path)) {
      files.set(path, data);
      continue;
    }
    const url = urls.get(path);
    if (url === undefined) problems.push(`${path} has no URL in ${SOURCES_FILE}: add the URL of the CC0 file`);
    sources.push({ path, url: url ?? "", bytes: data.byteLength, sha256: sha256(data) });
  }
  const list: TemplateSources = { format: SOURCES_FORMAT, rights: previous?.rights ?? RIGHTS, files: sources };
  files.set(SOURCES_FILE, new TextEncoder().encode(`${JSON.stringify(list, null, 2)}\n`));
  return { files, problems };
}

/** The differences between the files and a template folder (each path that is new, other or gone). */
export function templateDifferences(files: ReadonlyMap<string, Uint8Array>, templateDir: string): string[] {
  const written = existsSync(templateDir) ? folderFiles(templateDir, () => false) : [];
  const differences = written.filter((path) => !files.has(path)).map((path) => `${path}: not in the sample`);
  for (const [path, data] of files) {
    const file = join(templateDir, ...path.split("/"));
    if (!existsSync(file)) differences.push(`${path}: not in the template`);
    else if (!Buffer.from(data).equals(readFileSync(file))) differences.push(`${path}: other bytes`);
  }
  return differences.sort();
}

function main(argv: readonly string[]): number {
  const previous = existsSync(join(TEMPLATE_DIR, SOURCES_FILE)) ? readSources(TEMPLATE_DIR) : null;
  const { files, problems } = templateFromSample(SAMPLE_DIR, previous);
  for (const problem of problems) console.error(`showroom-template: ${problem}`);
  if (problems.length > 0) return 1;
  if (argv.includes("--check")) {
    const differences = templateDifferences(files, TEMPLATE_DIR);
    for (const difference of differences) console.error(`showroom-template: ${difference}`);
    if (differences.length > 0) console.error("showroom-template: run bun tools/showroom-template.ts");
    else console.log(`showroom-template: current (${String(files.size)} files)`);
    return differences.length === 0 ? 0 : 1;
  }
  rmSync(TEMPLATE_DIR, { recursive: true, force: true });
  for (const [path, data] of files) {
    const file = join(TEMPLATE_DIR, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  console.log(`showroom-template: wrote ${String(files.size)} files to ${TEMPLATE_DIR}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
