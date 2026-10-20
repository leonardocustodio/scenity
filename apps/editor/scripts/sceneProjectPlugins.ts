// SPDX-License-Identifier: Apache-2.0
/**
 * The Vite plugin of the project plugins of the scene page. The scene page serves many projects (scripts/projects.ts),
 * so `virtual:scenity/plugins` of `@scenity/cli/vite` (one project) does not fit.
 * This plugin gives `virtual:scenity/project-plugins`: `loadProjectPlugins(project)` gives the runtime faces of the
 * plugins of one project, each a dynamic import (a chunk of its own). The page registers their components, so the
 * inspector shows the components of a plugin with no editor code.
 *
 * The resolver of the CLI finds the plugins (the `plugins` field of `scenity.project.json`). A project that does not
 * load gets no plugins and a warning. A change of a project document makes the module again.
 *
 * The plugin also gives `virtual:scenity/plugins` for the player pages of this server (player/*.html). Its
 * `loadPlugins(set)` is `loadProjectPlugins(set)`, so a player names its project as the plugin set. The scene worker
 * and the player worker import these modules too, so the worker build of the config needs this plugin.
 *
 * `loadProjectDevPlugins(project)` gives the metric faces of the plugins (`scenity.dev`). The scene worker and the
 * main-thread core add their metric libraries to the rule check, and the rules editor shows their metrics.
 * The module `virtual:scenity/project-studio` gives `loadProjectStudioPlugins(project)`: the studio faces
 * (`scenity.studio`) for the editor window. Only the studio faces module of the page imports it and takes its
 * hot updates, so an edit of a studio face installs the faces again with no reload.
 */
import { resolveProjectPlugins } from "@scenity/cli/plugins";
import type { Plugin } from "vite";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";

/** The ID of the virtual module. */
export const PROJECT_PLUGINS_MODULE = "virtual:scenity/project-plugins";
const RESOLVED = `\0${PROJECT_PLUGINS_MODULE}`;
/** The plugin module of a build (`@scenity/cli/vite`), here over the projects of the server. */
const PLUGINS_MODULE = "virtual:scenity/plugins";
const RESOLVED_PLUGINS = `\0${PLUGINS_MODULE}`;

/** The module of the studio faces only. */
export const PROJECT_STUDIO_MODULE = "virtual:scenity/project-studio";
const RESOLVED_STUDIO = `\0${PROJECT_STUDIO_MODULE}`;

/** The prefix of the module of the plugins of one project that the server added after its start. */
export const PROJECT_PLUGINS_OF = "virtual:scenity/project-plugins-of/";

/** The `import()` of a runtime face file (an absolute path). */
function importOf(file: string): string {
  return `import(${JSON.stringify(file.split("\\").join("/"))})`;
}

/**
 * The code of the module from the runtime face files of each project (absolute paths). In dev, a project that the
 * module does not name (the server added it after the start) loads its plugins from a module of its own. Thus the
 * module of the other projects stays and no open page reloads.
 */
export function projectPluginsCode(
  runtimes: Readonly<Record<string, readonly string[]>>,
  dev = false,
  devFaces: Readonly<Record<string, readonly string[]>> = {},
): string {
  const rowsOf = (faces: Readonly<Record<string, readonly string[]>>): string[] =>
    Object.entries(faces).map(([name, files]) => {
      const loaders = files.map((file) => `() => ${importOf(file)}`);
      return `  ${JSON.stringify(name)}: [${loaders.join(", ")}],`;
    });
  const rows = rowsOf(runtimes);
  const lateOf = (table: string, field: string): string[] =>
    dev
      ? [
          `  if (!Object.hasOwn(${table}, project) && /^[a-z0-9-]+$/.test(project)) {`,
          `    const late = await import(/* @vite-ignore */ \`/@id/__x00__${PROJECT_PLUGINS_OF}\${project}\`);`,
          `    return late.${field};`,
          "  }",
        ]
      : [];
  const late = lateOf("projects", "default");
  return [
    "// The runtime faces of the plugins of each project of the scene page.",
    "const projects = {",
    ...rows,
    "};",
    "export async function loadProjectPlugins(project) {",
    ...late,
    "  const loaders = Object.hasOwn(projects, project) ? projects[project] : [];",
    "  const modules = await Promise.all(loaders.map((load) => load()));",
    "  return modules.map((module) => module.default);",
    "}",
    "// The metric faces of the plugins of each project.",
    "const devProjects = {",
    ...rowsOf(devFaces),
    "};",
    "export async function loadProjectDevPlugins(project) {",
    ...lateOf("devProjects", "devFaces"),
    "  const loaders = Object.hasOwn(devProjects, project) ? devProjects[project] : [];",
    "  const modules = await Promise.all(loaders.map((load) => load()));",
    "  return modules.map((module) => module.default);",
    "}",
    // The studio faces are in a module of their own (projectStudioCode).
    "",
  ].join("\n");
}

/** The code of the module of the studio faces of each project. */
export function projectStudioCode(studioFaces: Readonly<Record<string, readonly string[]>>, dev = false): string {
  const rows = Object.entries(studioFaces).map(([name, files]) => {
    const loaders = files.map((file) => `() => ${importOf(file)}`);
    return `  ${JSON.stringify(name)}: [${loaders.join(", ")}],`;
  });
  const late = dev
    ? [
        "  if (!Object.hasOwn(studioProjects, project) && /^[a-z0-9-]+$/.test(project)) {",
        `    const late = await import(/* @vite-ignore */ \`/@id/__x00__${PROJECT_PLUGINS_OF}\${project}\`);`,
        "    return late.studioFaces();",
        "  }",
      ]
    : [];
  return [
    "// The studio faces of the plugins of each project.",
    "const studioProjects = {",
    ...rows,
    "};",
    "export async function loadProjectStudioPlugins(project) {",
    ...late,
    "  const loaders = Object.hasOwn(studioProjects, project) ? studioProjects[project] : [];",
    "  const modules = await Promise.all(loaders.map((load) => load()));",
    "  return modules.map((module) => module.default);",
    "}",
    "",
  ].join("\n");
}

/** The code of the module of the plugins of one project, with their dev faces and studio faces. */
export function lateProjectPluginsCode(
  files: readonly string[],
  devFiles: readonly string[] = [],
  studioFiles: readonly string[] = [],
): string {
  return [
    "// The runtime faces of the plugins of one project that came after the start of the server.",
    `const modules = await Promise.all([${files.map(importOf).join(", ")}]);`,
    "export default modules.map((module) => module.default);",
    `const devModules = await Promise.all([${devFiles.map(importOf).join(", ")}]);`,
    "export const devFaces = devModules.map((module) => module.default);",
    // The studio faces load on a call. The editor window asks for them after its start.
    `export const studioFaces = () => Promise.all([${studioFiles.map(importOf).join(", ")}]).then((all) => all.map((module) => module.default));`,
    "",
  ].join("\n");
}

/**
 * The runtime face files and the metric face files of the plugins of a project. A project that does not load gives
 * none and a warning.
 */
async function facesOf(
  name: string,
  dir: string,
  context: { addWatchFile(file: string): void; warn(text: string): void },
): Promise<{ runtime: string[]; dev: string[]; studio: string[] }> {
  try {
    const found = await resolveProjectPlugins(dir);
    context.addWatchFile(found.projectFile);
    return {
      runtime: found.plugins.flatMap((plugin) => (plugin.runtime === undefined ? [] : [plugin.runtime])),
      dev: found.plugins.flatMap((plugin) => (plugin.dev === undefined ? [] : [plugin.dev])),
      studio: found.plugins.flatMap((plugin) => (plugin.studio === undefined ? [] : [plugin.studio])),
    };
  } catch (error) {
    context.warn(`the plugins of the project "${name}": ${error instanceof Error ? error.message : String(error)}`);
    return { runtime: [], dev: [], studio: [] };
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute). The record can change in dev. */
export function sceneProjectPlugins(projects: Readonly<Record<string, string>>): Plugin {
  let dev = false;
  return {
    name: "scenity:project-plugins",
    configResolved(config) {
      dev = config.command === "serve";
    },
    resolveId(id) {
      if (id === PLUGINS_MODULE) return RESOLVED_PLUGINS;
      if (id.startsWith(PROJECT_PLUGINS_OF)) return `\0${id}`;
      if (id === PROJECT_STUDIO_MODULE) return RESOLVED_STUDIO;
      return id === PROJECT_PLUGINS_MODULE ? RESOLVED : undefined;
    },
    async load(id) {
      if (id === RESOLVED_PLUGINS) {
        return `export const pluginKeys = [];\nexport { loadProjectPlugins as loadPlugins } from ${JSON.stringify(PROJECT_PLUGINS_MODULE)};\n`;
      }
      if (id.startsWith(`\0${PROJECT_PLUGINS_OF}`)) {
        const name = id.slice(PROJECT_PLUGINS_OF.length + 1);
        const dir = Object.hasOwn(projects, name) ? projects[name] : undefined;
        // A project that the owner did not trust gets no plugin code.
        const allowed = dir !== undefined && !RESTRICTED_PROJECTS.has(name);
        const faces = allowed ? await facesOf(name, dir, this) : { runtime: [], dev: [], studio: [] };
        return lateProjectPluginsCode(faces.runtime, faces.dev, faces.studio);
      }
      if (id === RESOLVED_STUDIO) {
        const studioFaces: Record<string, string[]> = {};
        for (const [name, dir] of Object.entries(projects))
          if (!RESTRICTED_PROJECTS.has(name)) studioFaces[name] = (await facesOf(name, dir, this)).studio;
        return projectStudioCode(studioFaces, dev);
      }
      if (id !== RESOLVED) return undefined;
      const runtimes: Record<string, string[]> = {};
      const devFaces: Record<string, string[]> = {};
      for (const [name, dir] of Object.entries(projects)) {
        // A restricted project takes the late module, which gives its plugins after the trust.
        if (RESTRICTED_PROJECTS.has(name)) continue;
        const faces = await facesOf(name, dir, this);
        runtimes[name] = faces.runtime;
        devFaces[name] = faces.dev;
      }
      return projectPluginsCode(runtimes, dev, devFaces);
    },
  };
}
