// SPDX-License-Identifier: Apache-2.0
/**
 * The plugins of a project: the loader reads the `plugins` field of the project document and finds the faces of each
 * entry. An entry is a path relative to the project folder (a folder or a file), or a package name.
 *
 * - The runtime face of a folder or a package is the `scenity.runtime` field of its package.json, else the first file
 *   of `RUNTIME_FILES` that exists.
 * - The host face is the `scenity.host` field, else the first file of `HOST_FILES`.
 * - The metric face (the metric library of the rules) is the `scenity.dev` field, else the first file of `DEV_FILES`.
 * - The studio face (the editor window) is the `scenity.studio` field, else the first file of `STUDIO_FILES`.
 * - The editor face (the `EditorPlugin` of the editor page) is the `scenity.editor` field, else the first file of
 *   `EDITOR_FILES`.
 * - The editor config face (the Vite parts of the editor: plugins, aliases, the dev server proxy, the styles) is the
 *   `scenity.editorConfig` field, else the first file of `EDITOR_CONFIG_FILES`.
 * - The CLI face (the commands of `scenity`) is the `scenity.cli` field only.
 *
 * A file entry is a runtime face only. A package name resolves from the project folder, else from the workspace above
 * it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadProject, PROJECT_FILE } from "@scenity/scene";

/** The files of a plugin folder that can hold the runtime face, in the order of the search. */
export const RUNTIME_FILES = ["runtime.ts", "src/runtime.ts", "runtime.js", "src/runtime.js"];
/** The files of a plugin folder that can hold the host face (the workbench host), in the order of the search. */
export const HOST_FILES = ["host.ts", "src/host.ts", "host.js", "src/host.js"];
/** The files of a plugin folder that can hold the metric face (the dev library of the rules), in order. */
export const DEV_FILES = ["dev.ts", "src/dev.ts", "dev.js", "src/dev.js"];

/** The files of a plugin folder that can hold the editor face (the editor page), in order. */
export const EDITOR_FILES = ["editor.ts", "src/editor.ts", "editor.js", "src/editor.js"];
/** The files of a plugin folder that can hold the editor config face (the Vite config of the editor), in order. */
export const EDITOR_CONFIG_FILES = ["editorConfig.ts", "src/editorConfig.ts", "editorConfig.js", "src/editorConfig.js"];

/** The files of a plugin folder that can hold the studio face (the editor window), in order. */
export const STUDIO_FILES = ["studio.ts", "src/studio.ts", "studio.js", "src/studio.js"];

/** The faces of a plugin that the loader finds, with the package.json field and the files of each. */
const FACES = {
  runtime: { field: "runtime", files: RUNTIME_FILES },
  host: { field: "host", files: HOST_FILES },
  dev: { field: "dev", files: DEV_FILES },
  studio: { field: "studio", files: STUDIO_FILES },
  editor: { field: "editor", files: EDITOR_FILES },
  editorConfig: { field: "editorConfig", files: EDITOR_CONFIG_FILES },
  // The commands of `scenity <command>`: only the package.json field names the face (no file search).
  cli: { field: "cli", files: [] as readonly string[] },
} as const;
type FaceName = keyof typeof FACES;

export interface ProjectPlugin {
  /** The entry in the `plugins` field of the project document. */
  readonly entry: string;
  /** The key of the virtual module `virtual:scenity/plugins/<key>`: letters, digits, `_` and `-`. */
  readonly key: string;
  /** The folder of the plugin (absolute). A change of a file in it reloads the page in dev. */
  readonly dir: string;
  /** The file of the runtime face (absolute), or undefined for a plugin with no runtime face. */
  readonly runtime: string | undefined;
  /** The file of the host face (absolute), or undefined for a plugin with no host face. */
  readonly host: string | undefined;
  /** The file of the metric face (a `MetricPlugin`: the plugin ID and its metric library), or undefined. */
  readonly dev?: string | undefined;
  /** The file of the studio face (the default export is `defineStudioPlugin(...)`), or undefined. */
  readonly studio?: string | undefined;
  /** The file of the editor face (the default export is an `EditorPlugin` of the editor page), or undefined. */
  readonly editor?: string | undefined;
  /** The file of the editor config face (the default export gives the Vite parts of the editor), or undefined. */
  readonly editorConfig?: string | undefined;
  /** The file of the CLI face (the default export gives the commands of `scenity`), or undefined. */
  readonly cli?: string | undefined;
}

export interface ProjectPlugins {
  readonly projectDir: string;
  /** The path of the project document (absolute). */
  readonly projectFile: string;
  /** The plugins in the order of the project document. */
  readonly plugins: readonly ProjectPlugin[];
  /** The sequence files of the project document (its `sequences` field), in their order. */
  readonly sequences: readonly string[];
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** True when `path` is `dir` or a path in it. */
export function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The fields of a package.json that the loader reads. */
interface PackageJson {
  readonly name?: unknown;
  readonly workspaces?: unknown;
  readonly scenity?: Readonly<Partial<Record<FaceName, unknown>>>;
}

function readPackage(path: string): PackageJson | undefined {
  return isFile(path) ? (JSON.parse(readFileSync(path, "utf8")) as PackageJson) : undefined;
}

/** The workspace patterns of a package.json: an array, or the `packages` field of an object (Bun, Yarn). */
function workspacePatterns(data: PackageJson | undefined): string[] | undefined {
  const field = data?.workspaces;
  const list = Array.isArray(field) ? field : (field as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : undefined;
}

/** The folders of one workspace pattern. A `*` part matches each folder name; `**` and `!` are not supported. */
function patternDirs(root: string, pattern: string): string[] {
  let dirs = [root];
  for (const part of pattern.split("/").filter((item) => item !== "" && item !== ".")) {
    dirs = dirs.flatMap((dir) => {
      if (part !== "*") return [join(dir, part)];
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
        .map((entry) => join(dir, entry.name))
        .sort();
    });
  }
  return dirs;
}

/**
 * The folder of a package of the workspace above the project folder: a sample project in a monorepo is not a
 * package, so an isolated install does not link its plugin packages. The nearest package.json with `workspaces` wins.
 */
function workspacePackageDir(name: string, projectDir: string): string | undefined {
  for (let dir = projectDir; ; dir = dirname(dir)) {
    const patterns = workspacePatterns(readPackage(join(dir, "package.json")));
    if (patterns !== undefined) {
      const found = patterns
        .filter((pattern) => !pattern.startsWith("!"))
        .flatMap((pattern) => patternDirs(dir, pattern))
        .find((folder) => readPackage(join(folder, "package.json"))?.name === name);
      return found;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** The folder of a package name, from the project folder, else from the workspace above it. */
export function packageDir(name: string, projectDir: string): string {
  const require = createRequire(join(projectDir, PROJECT_FILE));
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    const found = workspacePackageDir(name, projectDir);
    if (found !== undefined) return found;
    throw new Error(`the plugin package "${name}" is not installed for the project ${projectDir}`);
  }
}

/** A face of a plugin folder, or undefined when the folder has none. */
function faceFile(dir: string, face: FaceName): string | undefined {
  const { field: name, files } = FACES[face];
  const manifest = join(dir, "package.json");
  const field = readPackage(manifest)?.scenity?.[name];
  if (typeof field === "string") {
    const path = resolve(dir, field);
    if (!isFile(path)) throw new Error(`${manifest}: the ${face} face "${field}" does not exist`);
    return path;
  }
  return files.map((file) => join(dir, file)).find(isFile);
}

/** The folder and the faces of one entry. */
function resolveEntry(entry: string, projectDir: string): Omit<ProjectPlugin, "entry" | "key"> {
  const faces = (dir: string) => ({
    dir,
    runtime: faceFile(dir, "runtime"),
    host: faceFile(dir, "host"),
    dev: faceFile(dir, "dev"),
    studio: faceFile(dir, "studio"),
    editor: faceFile(dir, "editor"),
    editorConfig: faceFile(dir, "editorConfig"),
    cli: faceFile(dir, "cli"),
  });
  if (!entry.startsWith(".") && !isAbsolute(entry)) return faces(packageDir(entry, projectDir));
  const path = resolve(projectDir, entry);
  if (isFile(path)) return { dir: dirname(path), runtime: path, host: undefined };
  if (!existsSync(path)) throw new Error(`the plugin "${entry}" of the project does not exist (${path})`);
  return faces(path);
}

/** The key of an entry: the name of its folder or package, with only letters, digits, `_` and `-`. */
function keyOf(entry: string, dir: string, used: Set<string>): string {
  const name = entry.startsWith(".") || isAbsolute(entry) ? basename(dir) : (entry.split("/").at(-1) ?? entry);
  const base = name.replace(/[^A-Za-z0-9_-]/g, "-") || "plugin";
  let key = base;
  for (let index = 2; used.has(key); index += 1) key = `${base}-${String(index)}`;
  used.add(key);
  return key;
}

/** Read the project document of a folder and find the runtime face of each plugin. */
export async function resolveProjectPlugins(project: string): Promise<ProjectPlugins> {
  const projectDir = resolve(project);
  const fs = { readText: (path: string) => (isFile(path) ? readFileSync(path, "utf8") : undefined) };
  const loaded = await loadProject(projectDir, fs);
  if (!loaded.ok) {
    const messages = loaded.errors.map((error) => `${error.path} ${error.message}`.trim());
    throw new Error(`${loaded.file}: ${messages.join("; ")}`);
  }
  const plugins = resolvePluginEntries(loaded.project.plugins ?? [], projectDir);
  const sequences = loaded.project.sequences ?? [];
  return { projectDir, projectFile: join(projectDir, PROJECT_FILE), plugins, sequences };
}

/**
 * Find the faces of plugin entries of a project folder (the `plugins` field of its document), in their order. The
 * workbench host reads the host faces with it. Throws for an entry that does not resolve.
 */
export function resolvePluginEntries(entries: readonly string[], projectDir: string): ProjectPlugin[] {
  const used = new Set<string>();
  return entries.map((entry) => {
    const found = resolveEntry(entry, projectDir);
    return { entry, key: keyOf(entry, found.dir, used), ...found };
  });
}

/**
 * The environment variable that points the editor app, the workbench host and the commands at a project
 * folder outside the checkout (for example the room project of CodeBlue). An absolute path, or a path from the
 * current folder.
 */
export const PROJECT_ENV = "SCENITY_PROJECT";

/**
 * The default project of the workspace of a folder: the `scenity.project` field of the nearest package.json with the
 * field, from `from` up, as an absolute folder. Null when no package.json has the field. The editor app opens this
 * project (the workbench host reads the same field). `SCENITY_PROJECT` of `env` comes first.
 */
export function defaultProjectDir(
  from: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const pointed = env[PROJECT_ENV];
  if (pointed !== undefined && pointed !== "") return resolve(pointed);
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const data = readPackage(join(dir, "package.json")) as
      { readonly scenity?: { readonly project?: unknown } } | undefined;
    const project = data?.scenity?.project;
    if (typeof project === "string") return resolve(dir, project);
    if (dirname(dir) === dir) return null;
  }
}
