// SPDX-License-Identifier: Apache-2.0
/**
 * The editor faces of the project plugins: the editor app names no plugin. The Vite config of the editor reads
 * the project, loads the editor config face of each plugin and writes two generated files from the project:
 *
 * - `editorPlugins.ts` imports the editor face of each plugin (the `scenity.editor` field) and exports the list
 *   `editorPlugins`, and the types of the editor face of the first plugin. The page registers the plugins from it.
 * - `editorStyles.css` imports the style files of the editor config faces (Tailwind sources, tokens). The styles of
 *   the editor import it, so Tailwind compiles the plugin styles with the styles of the editor.
 *
 * A generated file changes only when the project changes, so the files are in the repository and `vue-tsc` reads them
 * with no Vite. The editor config face (the `scenity.editorConfig` field) gives the Vite parts of a plugin: plugins of
 * the page and of the workers, aliases, the proxy and the served folders of the dev server, the styles, the content
 * files of the frame key and the pictures of the content browser.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ContentConfig } from "@scenity/labs-platform/contentHash";
import type { Alias, PluginOption, ProxyOptions } from "vite";
import { resolveProjectPlugins, type ProjectPlugin } from "./resolve.ts";

/** The values that an editor config face can read. */
export interface EditorConfigContext {
  /** The environment of the process. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The root of the workspace (absolute). */
  readonly root: string;
}

/** The Vite parts of the editor that a plugin gives (the default export of its editor config face). */
export interface EditorConfigFace {
  /** The Vite plugins of the page and the dev server. */
  plugins?(context: EditorConfigContext): PluginOption[];
  /** The Vite plugins of the worker builds. */
  workerPlugins?(context: EditorConfigContext): PluginOption[];
  /** The aliases of the module resolution. */
  readonly alias?: readonly Alias[];
  /** The proxy rules of the dev server. */
  proxy?(context: EditorConfigContext): Record<string, string | ProxyOptions>;
  /** The folders outside the workspace packages that the dev server may serve (absolute paths). */
  readonly fsAllow?: readonly string[];
  /** The style files (absolute paths) that the styles of the editor import, in order. */
  readonly styles?: readonly string[];
  /** The content files of the frame key. The first plugin that gives it wins. */
  readonly content?: ContentConfig;
  /** The folder of the pictures of the content browser (absolute). The first plugin that gives it wins. */
  readonly stills?: string;
  /**
   * The take of the lab that the tools start with (the warm pages of the render pool, a job with no take).
   * The first plugin that gives it wins.
   */
  readonly defaultTake?: string;
}

/** The Vite parts of all the plugins of a project, in the order of the project document. */
export interface EditorConfig {
  readonly plugins: PluginOption[];
  /** The worker plugins: a new list for each worker build, as Vite asks for `worker.plugins`. */
  workerPlugins(): PluginOption[];
  readonly alias: Alias[];
  readonly proxy: Record<string, string | ProxyOptions>;
  readonly fsAllow: string[];
  readonly styles: string[];
  /** The content files of the frame key: of the first plugin that gives them, else none. */
  readonly content: ContentConfig;
  /** The folder of the pictures of the content browser: of the first plugin that gives it, else `<project>/stills`. */
  readonly stills: string;
  /** The take of the tools: of the first plugin that gives it, else the first sequence, else null. */
  readonly defaultTake: string | null;
}

/** The editor parts of a project. */
export interface EditorProject {
  /** The project folder (absolute). */
  readonly projectDir: string;
  /** The plugins of the project document, in its order. */
  readonly plugins: readonly ProjectPlugin[];
  /** The Vite parts of the editor config faces. */
  readonly config: EditorConfig;
}

/** The licence header of a generated file, as comment lines of the given form. */
function header(line: (text: string) => string): string[] {
  return [line("SPDX-License-Identifier: Apache-2.0")];
}

/** The import path of a file from a folder: relative, with `/` as the separator. */
function importPath(fromDir: string, file: string): string {
  const path = relative(fromDir, file).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/** Load the editor config face of a plugin. Throws when the default export is not an object. */
async function configFace(plugin: ProjectPlugin): Promise<EditorConfigFace> {
  if (plugin.editorConfig === undefined) return {};
  const module = (await import(plugin.editorConfig)) as { readonly default?: unknown };
  if (typeof module.default !== "object" || module.default === null) {
    throw new Error(`The editor config face ${plugin.editorConfig} of "${plugin.entry}" has no default export object.`);
  }
  return module.default;
}

/** Merge the editor config faces, in their order. */
export function mergeEditorConfig(
  faces: readonly EditorConfigFace[],
  context: EditorConfigContext,
  projectDir: string,
  sequences: readonly string[] = [],
): EditorConfig {
  return {
    plugins: faces.flatMap((face) => face.plugins?.(context) ?? []),
    workerPlugins: () => faces.flatMap((face) => face.workerPlugins?.(context) ?? []),
    alias: faces.flatMap((face) => [...(face.alias ?? [])]),
    proxy: Object.assign({}, ...faces.map((face) => face.proxy?.(context) ?? {})) as EditorConfig["proxy"],
    fsAllow: faces.flatMap((face) => [...(face.fsAllow ?? [])]),
    styles: faces.flatMap((face) => [...(face.styles ?? [])]),
    content: faces.find((face) => face.content !== undefined)?.content ?? { roots: [], manifest: null, excluded: [] },
    stills: faces.find((face) => face.stills !== undefined)?.stills ?? join(projectDir, "stills"),
    defaultTake: faces.find((face) => face.defaultTake !== undefined)?.defaultTake ?? sequenceName(sequences[0]),
  };
}

/** The name of a sequence file (`<name>.sequence.json`, as the host gives it), or null. */
function sequenceName(file: string | undefined): string | null {
  if (file === undefined) return null;
  return (file.split("/").pop() ?? file).replace(/\.sequence\.json$/, "");
}

/** Read a project and load the editor config faces of its plugins. */
export async function loadEditorProject(project: string, context: EditorConfigContext): Promise<EditorProject> {
  const found = await resolveProjectPlugins(project);
  const faces = await Promise.all(found.plugins.map(configFace));
  return {
    projectDir: found.projectDir,
    plugins: found.plugins,
    config: mergeEditorConfig(faces, context, found.projectDir, found.sequences),
  };
}

/** The code of `editorPlugins.ts` in the folder `outDir`. */
export function editorPluginsCode(plugins: readonly ProjectPlugin[], outDir: string, projectDir: string): string {
  const files = plugins.flatMap((plugin) => (plugin.editor === undefined ? [] : [importPath(outDir, plugin.editor)]));
  const names = files.map((_, index) => `editor${String(index)}`);
  const lines = [
    ...header((text) => `// ${text}`),
    `// The editor faces of the plugins of the project ${importPath(outDir, projectDir)}. The editor Vite config`,
    "// writes this file from the project document (packages/cli/src/vite/editor.ts). Do not edit it.",
    ...files.map((file, index) => `import ${names[index] ?? ""} from ${JSON.stringify(file)};`),
    "",
    "/** The editor faces, in the order of the project document. */",
    `export const editorPlugins = [${names.join(", ")}] as const;`,
  ];
  const first = files[0];
  if (first !== undefined) {
    lines.push("", "/** The types of the editor face of the first plugin: the editor core reads them. */");
    lines.push(`export type * from ${JSON.stringify(first)};`);
  }
  return `${lines.join("\n")}\n`;
}

/** The code of `editorStyles.css` in the folder `outDir`. */
export function editorStylesCode(styles: readonly string[], outDir: string, projectDir: string): string {
  const lines = [
    ...header((text) => `/* ${text} */`),
    `/* The styles of the plugins of the project ${importPath(outDir, projectDir)}. The editor Vite config writes`,
    "   this file from the project document (packages/cli/src/vite/editor.ts). Do not edit it. */",
    ...styles.map((file) => `@import ${JSON.stringify(importPath(outDir, file))};`),
  ];
  return `${lines.join("\n")}\n`;
}

/** The generated files of a project: the file name in `outDir` → the text. */
export function editorFiles(project: EditorProject, outDir: string): Record<string, string> {
  return {
    "editorPlugins.ts": editorPluginsCode(project.plugins, outDir, project.projectDir),
    "editorStyles.css": editorStylesCode(project.config.styles, outDir, project.projectDir),
  };
}

/** Write the generated files of a project into `outDir`. Only a changed file is written. Gives the written names. */
export function writeEditorFiles(project: EditorProject, outDir: string): string[] {
  const written: string[] = [];
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(editorFiles(project, outDir))) {
    const path = join(outDir, name);
    if (existsSync(path) && readFileSync(path, "utf8") === text) continue;
    writeFileSync(path, text);
    written.push(name);
  }
  return written;
}
