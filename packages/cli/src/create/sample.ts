// SPDX-License-Identifier: Apache-2.0
/**
 * The sample templates of `scenity create`: `--template sample:<name>` makes a project from a sample of the checkout.
 * The project gets each file of the sample except its outputs (`dist`, `.scenity`, `node_modules`), with its own ID and
 * name. Its package.json links the plugin packages of the sample (for example `@scenity/physics-runtime`) and takes the
 * dependencies of the folder plugins (zod, three, the engine packages), so the plugins resolve their imports outside
 * the checkout. Only a checkout has the samples.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_FILE } from "@scenity/scene";
import { canonicalJson } from "@scenity/scene/canonical";
import { folderFiles } from "./showroom";
import type { TemplateFiles } from "./templates";

/** The samples that a project can start from (the showroom has its own template). */
export const SAMPLE_TEMPLATES = ["characters", "gltf-samples", "physics", "sim-road", "spin", "walkthrough"] as const;
export const SAMPLE_PREFIX = "sample:";
/** The folders of a sample that a new project does not take. */
const OUTPUTS = new Set(["dist", ".scenity", "node_modules"]);

/** The sample name of a template (`sample:<name>`), or null. */
export function sampleOf(template: string): string | null {
  if (!template.startsWith(SAMPLE_PREFIX)) return null;
  const name = template.slice(SAMPLE_PREFIX.length);
  return (SAMPLE_TEMPLATES as readonly string[]).includes(name) ? name : null;
}

export interface SampleTemplate {
  readonly files: TemplateFiles;
  /** The dependencies that the project package.json adds: links and published ranges. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** The package folders of the checkout that `--install` links (`bun link`). */
  readonly links: readonly string[];
}

type PackageJson = { name?: string; dependencies?: Record<string, string> };

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/** The folder of each workspace package of the checkout, by package name. */
export function workspaceFolders(checkout: string): Map<string, string> {
  const folders = new Map<string, string>();
  const scan = (parent: string, depth: number): void => {
    if (!existsSync(parent)) return;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const dir = join(parent, entry.name);
      const manifest = join(dir, "package.json");
      if (existsSync(manifest)) {
        const name = (readJson(manifest) as PackageJson).name;
        if (name !== undefined) folders.set(name, dir);
      } else if (depth > 1) scan(dir, depth - 1);
    }
  };
  scan(join(checkout, "packages"), 1);
  scan(join(checkout, "apps"), 1);
  scan(join(checkout, "plugins"), 2);
  return folders;
}

/** The version of a dependency outside the checkout: a link for a workspace package, the catalog value for `catalog:`.
 * */
function versionOf(name: string, value: string, catalog: Readonly<Record<string, string>>): string {
  if (value.startsWith("workspace:")) return `link:${name}`;
  if (value === "catalog:") return catalog[name] ?? "latest";
  return value;
}

/** The files and the dependencies of a project from the sample `sample` with the ID `id` and the name `name`. */
export function sampleTemplate(checkout: string, sample: string, id: string, name: string): SampleTemplate {
  const dir = join(checkout, "samples", sample);
  if (!existsSync(join(dir, PROJECT_FILE))) throw new Error(`the checkout has no sample ${sample}`);
  const files: TemplateFiles = new Map();
  const skip = (path: string): boolean => path.split("/").some((part) => OUTPUTS.has(part));
  for (const path of folderFiles(dir, skip)) files.set(path, new Uint8Array(readFileSync(join(dir, path))));
  const project = readJson(join(dir, PROJECT_FILE)) as Record<string, unknown>;
  files.set(PROJECT_FILE, canonicalJson({ ...project, id, name }));

  const catalog =
    (readJson(join(checkout, "package.json")) as { workspaces?: { catalog?: Record<string, string> } }).workspaces
      ?.catalog ?? {};
  const folders = workspaceFolders(checkout);
  const dependencies: Record<string, string> = {};
  for (const entry of (project.plugins as string[] | undefined) ?? []) {
    if (entry.startsWith(".") || entry.startsWith("/")) {
      const manifest = join(dir, entry, "package.json");
      const deps = existsSync(manifest) ? ((readJson(manifest) as PackageJson).dependencies ?? {}) : {};
      for (const [dep, value] of Object.entries(deps)) dependencies[dep] = versionOf(dep, value, catalog);
    } else dependencies[entry] = `link:${entry}`;
  }
  const links = Object.entries(dependencies)
    .filter(([, value]) => value.startsWith("link:"))
    .map(([dep]) => folders.get(dep))
    .filter((folder): folder is string => folder !== undefined);
  return { files, dependencies, links: [...new Set(links)].sort() };
}
