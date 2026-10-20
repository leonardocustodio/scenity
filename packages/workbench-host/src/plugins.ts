// SPDX-License-Identifier: Apache-2.0
/**
 * The plugins of the host: the one host module that loads a plugin. The host
 * imports no plugin package. It reads the `plugins` field of the project document and loads the host face of each
 * entry (`resolvePluginEntries` of `@scenity/cli/plugins`: the `scenity.host` field of the package.json of the plugin,
 * else `host.ts` or `src/host.ts`), as the Vite plugin of `@scenity/cli/vite` finds the runtime faces.
 *
 * - A project with `scenity.project.json` gets the host faces of its plugins (project.ts `loadHostProject`).
 * - A checkout with no project document gets the built-in plugins: the plugins of the default project of the
 *   workspace of the host (the `scenity.project` field of the root package.json).
 *
 * The host sets the plugins of the open project with `useHostPlugins`. The other host modules read the plugins only
 * through the functions here.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { resolvePluginEntries } from "@scenity/cli/plugins";
import { contentSource, type FrameIndexSource } from "@scenity/labs-platform/indexSource";
import { PROJECT_FILE } from "@scenity/scene";
import type { HostContextLines, HostPaths, HostPlugin, HostRuns, HostSurface } from "./plugin";
import type { ToolDef } from "./tools/kit";

/** A synchronous loader: the host reads the plugins before its first tool list, and a tool list is synchronous. */
const load = createRequire(import.meta.url);

/** The plugins of the open project, or null for the built-in plugins. */
let active: readonly HostPlugin[] | null = null;
/** The built-in plugins after the first load. */
let builtIn: { readonly dir: string | null; readonly plugins: readonly HostPlugin[] } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True when a value has the fields of a host face that the host reads. */
export function isHostPlugin(value: unknown): value is HostPlugin {
  if (!isRecord(value)) return false;
  const { id, tools, contextLines, runs, paths } = value;
  const commands = isRecord(runs) ? runs.commands : undefined;
  return (
    typeof id === "string" && Array.isArray(tools) && isRecord(contextLines) && isRecord(commands) && isRecord(paths)
  );
}

/** Load the host face of one plugin from its file. Throws when the default export is not a host face. */
function faceOf(file: string, entry: string): HostPlugin {
  const module = load(file) as { readonly default?: unknown };
  if (!isHostPlugin(module.default)) {
    throw new Error(`The host face ${file} of the plugin "${entry}" gives no host plugin as its default export.`);
  }
  return module.default;
}

/**
 * Load the host faces of the plugin entries of a project folder, in their order. A plugin with no host face gives
 * nothing. Throws for an entry that does not resolve or a bad host face.
 */
export function loadHostPlugins(projectDir: string, entries: readonly string[]): HostPlugin[] {
  return resolvePluginEntries(entries, projectDir).flatMap((plugin) =>
    plugin.host === undefined ? [] : [faceOf(plugin.host, plugin.entry)],
  );
}

/** The plugin entries of the project document of a folder, or an empty list when the folder has no document. */
function projectEntries(projectDir: string): string[] {
  const file = join(projectDir, PROJECT_FILE);
  if (!existsSync(file)) return [];
  const doc = JSON.parse(readFileSync(file, "utf8")) as { readonly plugins?: unknown };
  return Array.isArray(doc.plugins) ? doc.plugins.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * The default project of the workspace of a folder: the `scenity.project` field of the nearest package.json with
 * the field, from `from` up, as an absolute folder. Null when no package.json has the field. The variable
 * `SCENITY_PROJECT` of `env` (a project folder outside the checkout) comes first.
 */
export function defaultProjectDir(
  from: string = import.meta.dir,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const pointed = env.SCENITY_PROJECT;
  if (pointed !== undefined && pointed !== "") return resolve(pointed);
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as { readonly scenity?: { readonly project?: unknown } };
      const project = data.scenity?.project;
      if (typeof project === "string") return resolve(dir, project);
    }
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The built-in plugins: the host faces of the plugins of the default project of the workspace of the host. The
 * host reads them again when the default project changes (`SCENITY_PROJECT`).
 */
export function builtInPlugins(): readonly HostPlugin[] {
  const dir = defaultProjectDir();
  if (builtIn?.dir !== dir) builtIn = { dir, plugins: dir === null ? [] : loadHostPlugins(dir, projectEntries(dir)) };
  return builtIn.plugins;
}

/**
 * The plugins of a folder with no project document: the plugins of the default project of its workspace (the
 * `scenity.project` field of the nearest package.json, or `SCENITY_PROJECT`), else the built-in plugins.
 */
export function workspacePlugins(folder: string): readonly HostPlugin[] {
  const dir = defaultProjectDir(folder);
  if (dir === null || dir === defaultProjectDir()) return builtInPlugins();
  return loadHostPlugins(dir, projectEntries(dir));
}

/** Set the plugins of the open project (null: the built-in plugins). The host calls it when it opens a project. */
export function useHostPlugins(plugins: readonly HostPlugin[] | null): void {
  active = plugins;
}

/** The host faces of the plugins of the open project, in the order of the project document. */
export function hostPlugins(): readonly HostPlugin[] {
  return active ?? builtInPlugins();
}

/** The tools of the plugins. */
export function pluginTools(plugins: readonly HostPlugin[] = hostPlugins()): ToolDef[] {
  return plugins.flatMap((plugin) => plugin.tools);
}

/** The examples of the plugins for core tools: a tool name → the sentences of the plugins, in order. */
export function pluginToolNotes(plugins: readonly HostPlugin[] = hostPlugins()): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const plugin of plugins) {
    for (const [name, note] of Object.entries(plugin.toolNotes ?? {})) {
      notes[name] = notes[name] === undefined ? note : `${notes[name]} ${note}`;
    }
  }
  return notes;
}

/** The paths of the plugins: a later plugin replaces a path of an earlier one. */
export function pluginPaths(plugins: readonly HostPlugin[] = hostPlugins()): HostPaths {
  return Object.assign({}, ...plugins.map((plugin) => plugin.paths)) as HostPaths;
}

/** The runs of the plugins: the commands of each plugin and the last gate. */
export function pluginRuns(plugins: readonly HostPlugin[] = hostPlugins()): HostRuns {
  const commands = Object.assign({}, ...plugins.map((plugin) => plugin.runs.commands)) as HostRuns["commands"];
  const gate = plugins.flatMap((plugin) => plugin.runs.gate ?? []).at(-1);
  return gate === undefined ? { commands } : { commands, gate };
}

/** The context lines of the plugins. */
export interface PluginContext extends Required<HostContextLines> {
  /** True when a plugin gives the rows of the scene (`members`); else the host gives the generic entity rows. */
  readonly rows: boolean;
}

/** The context lines of the plugins: the lines of each plugin, one after the other. */
export function pluginContext(plugins: readonly HostPlugin[] = hostPlugins()): PluginContext {
  const faces = plugins.map((plugin) => plugin.contextLines);
  return {
    rows: faces.some((face) => face.members !== undefined),
    members: (report) => faces.flatMap((face) => face.members?.(report) ?? []),
    state: (state) => faces.flatMap((face) => face.state?.(state) ?? []),
    summary: (state) => faces.find((face) => face.summary !== undefined)?.summary?.(state) ?? state,
  };
}

/** The frame index source of the built-in project: the source of a plugin, else a source with no content. */
export function builtInIndexSource(plugins: readonly HostPlugin[] = hostPlugins()): FrameIndexSource {
  const source = plugins.find((plugin) => plugin.indexSource !== undefined)?.indexSource;
  return source ?? contentSource({ roots: [], manifest: null, excluded: [] });
}

/**
 * The surfaces of the plugins: the surfaces of the first plugin that gives some, else one editor surface of
 * the kind `scene` (the editor server of the host).
 */
export function builtInSurfaces(plugins: readonly HostPlugin[] = hostPlugins()): readonly HostSurface[] {
  const given = plugins.find((plugin) => plugin.surfaces !== undefined && plugin.surfaces.length > 0)?.surfaces;
  return given ?? [{ id: "editor", kind: "scene", label: "Editor" }];
}
