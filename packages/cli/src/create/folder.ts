// SPDX-License-Identifier: Apache-2.0
/**
 * The folder templates of `scenity create`: `--from <folder>` makes a project from a copy of a project folder (a
 * template of the person or of a plugin). The project gets each file of the folder, except its outputs and its local
 * state (`dist`, `node_modules`, `.git`, and `.scenity` except the recipes, the skills and the settings of the
 * plugins). The project gets its own ID and name. Its package.json takes the dependencies of the package.json of the
 * folder, and `--install` links the packages of the checkout that they link.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_FILE } from "@scenity/scene";
import { canonicalJson } from "@scenity/scene/canonical";
import { workspaceFolders, type SampleTemplate } from "./sample";
import type { TemplateFiles } from "./templates";

/** The folders that a template never takes. */
const OUTPUTS = new Set(["dist", "node_modules", ".git", "test-results"]);
/** The parts of `.scenity` that a template takes: the project data of the person, not the local state. */
const PROJECT_STATE = new Set(["recipes", "skills", "plugin-settings.json"]);
/** The files that the create writes itself. */
const OWN = new Set(["package.json"]);

/** True when a path of a project folder (with `/`) is not a part of a template. */
export function notInTemplate(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => OUTPUTS.has(part)) || OWN.has(path)) return true;
  return parts[0] === ".scenity" && parts.length > 1 && !PROJECT_STATE.has(parts[1] ?? "");
}

/** The files of a template folder (the paths with `/`, in path order). */
export function templateFolderFiles(dir: string, at = ""): string[] {
  return readdirSync(join(dir, at))
    .sort()
    .flatMap((name) => {
      const path = at === "" ? name : `${at}/${name}`;
      if (notInTemplate(path)) return [];
      return statSync(join(dir, path)).isDirectory() ? templateFolderFiles(dir, path) : [path];
    });
}

/** The files and the dependencies of a project from the folder `dir` with the ID `id` and the name `name`. */
export function folderTemplate(dir: string, id: string, name: string, checkout: string | null): SampleTemplate {
  if (!existsSync(join(dir, PROJECT_FILE))) throw new Error(`${dir} has no ${PROJECT_FILE}`);
  const files: TemplateFiles = new Map();
  for (const path of templateFolderFiles(dir)) files.set(path, new Uint8Array(readFileSync(join(dir, path))));
  const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")) as Record<string, unknown>;
  files.set(PROJECT_FILE, canonicalJson({ ...project, id, name }));
  const manifest = join(dir, "package.json");
  const dependencies = existsSync(manifest)
    ? ((JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {})
    : {};
  const folders = checkout === null ? new Map<string, string>() : workspaceFolders(checkout);
  const links = Object.entries(dependencies)
    .filter(([, value]) => value.startsWith("link:"))
    .map(([dep]) => folders.get(dep))
    .filter((folder): folder is string => folder !== undefined);
  return { files, dependencies, links: [...new Set(links)].sort() };
}
