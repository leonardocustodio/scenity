// SPDX-License-Identifier: Apache-2.0
/**
 * The project of the host: the host reads `scenity.project.json` of the project folder with `loadProject` of
 * `@scenity/scene`, and fills the defaults of the workbench part. A folder without the file is the checkout of this
 * repository: the built-in manifest gives the lab of the built-in plugins (`defaultWorkbench`).
 *
 * What the host does with each field:
 *
 * - `surfaces`: `host.hello` lists them with their capabilities, page, hidden flag and order. The host
 *   runs each surface of the kind `scene` on its editor server (the Vite of apps/editor), under its manifest ID. The
 *   first surface with the capability `scene` gets the shadow frame, the built lab and the tools. A surface without
 *   a capability list gets the defaults of its kind (`KIND_CAPABILITIES`).
 * - `setup`: the setup of a new worktree (checkoutSetup.ts).
 * - `contentRoots`: the content hash of the frame index (`projectContent` of `@scenity/labs-platform`).
 * - the scenes and the sequences give the plans of the frame index (index/projectSource.ts). The built-in
 *   project gives the source of the host plugin (plugins.ts `builtInIndexSource`).
 * - `plugins`: the host faces of the plugins (plugins.ts `loadHostPlugins`) give the tools, the context
 *   lines and the paths. A manifest with no `workbench` part gets the surfaces, the runs and the gate of its plugins.
 * - `denylist`: more patterns for the denylist of the host (denylist.ts).
 * - `credentialFile`: the file of the API key of the chat mode (agent/credential.ts).
 * - `theme`: the page applies it.
 * - `runs` and `gate`: the run catalog of the project (runCatalog.ts): the runs of the plugins and of the
 *   manifest, and the stop gate (`scenity check` for a project with a manifest and no gate). `host.hello` lists the
 *   command lines. `runs.commands` gives the whole runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { loadProject, PROJECT_FILE, type ProjectDocument, type WorkbenchSettings } from "@scenity/scene";
import { projectContent, type ContentConfig } from "@scenity/labs-platform/contentHash";
import { contentSource, type FrameIndexSource } from "@scenity/labs-platform/indexSource";
import { projectIndexSource } from "./index/projectSource";
import type { HostPlugin } from "./plugin";
import {
  builtInIndexSource,
  builtInPlugins,
  builtInSurfaces,
  loadHostPlugins,
  pluginRuns,
  workspacePlugins,
} from "./plugins";
import { projectRunCatalog, type RunCatalog } from "./runCatalog";
import {
  CHECKOUT_SETUP_LINE,
  INDEX_CAPABILITY,
  SCENE_CAPABILITY,
  surfaceWith,
  type ProjectInfo,
  type ProjectSurfaceInfo,
} from "./protocol";

/** The project of the host with the content config of its frame index. */
export interface HostProject extends ProjectInfo {
  /** The content config of the frame index, relative to the checkout (`index.content`). */
  readonly content: ContentConfig;
  /** The source of the frame index: the content config and the plans of the project. */
  readonly index: FrameIndexSource;
  /** The host faces of the plugins of the project (the built-in plugins for a folder with no manifest). */
  readonly plugins: readonly HostPlugin[];
  /** The runs of the project and its stop gate. */
  readonly runCatalog: RunCatalog;
}

/** The file of the API key when the manifest names none (agent/credential.ts). */
export const DEFAULT_CREDENTIAL_FILE = ".env";

/** The kind of a surface that the editor server of the host serves (the Vite of apps/editor). */
export const SCENE_KIND = "scene";
/** The capabilities of a surface kind when the manifest gives no list. */
export const KIND_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  [SCENE_KIND]: [SCENE_CAPABILITY, INDEX_CAPABILITY],
};

/**
 * The workbench part that the plugins give: their surfaces, their runs and their gate. A
 * manifest with no `workbench` part gets it.
 */
export function pluginWorkbench(plugins: readonly HostPlugin[]): WorkbenchSettings {
  const runs = pluginRuns(plugins);
  return {
    surfaces: [...builtInSurfaces(plugins)],
    runs: { ...runs.commands },
    ...(runs.gate === undefined ? {} : { gate: runs.gate }),
  };
}

/**
 * The built-in manifest of this checkout: the surfaces, the runs and the gate of the built-in plugins, the setup of
 * a new worktree and the content roots of the frame index source of the plugins.
 */
export function defaultWorkbench(plugins: readonly HostPlugin[] = builtInPlugins()): WorkbenchSettings {
  return {
    ...pluginWorkbench(plugins),
    setup: CHECKOUT_SETUP_LINE,
    contentRoots: [...builtInIndexSource(plugins).content.roots],
    credentialFile: DEFAULT_CREDENTIAL_FILE,
  };
}

/** The path of a project folder relative to the checkout, with `/` ("" for the checkout itself). */
function baseOf(checkout: string, dir: string): string {
  const near = relative(checkout, dir);
  return near === "" ? "" : near.split(sep).join("/");
}

/** The surface info of a manifest surface at a place of the list, with the defaults filled in. */
function surfaceInfo(surface: WorkbenchSettings["surfaces"][number], at: number): ProjectSurfaceInfo {
  const { id, kind, label } = surface;
  return {
    id,
    kind,
    label,
    capabilities: [...(surface.capabilities ?? KIND_CAPABILITIES[kind] ?? [])],
    page: surface.page ?? null,
    hidden: surface.hidden === true,
    order: surface.order ?? at + 1,
  };
}

/**
 * The default sequence of a project: the default of the first host plugin that gives one, else the name of
 * the first sequence file of the project document (`<name>.sequence.json`), else null.
 */
export function defaultSequence(
  plugins: readonly HostPlugin[],
  sequences: readonly string[] | undefined,
): string | null {
  const given = plugins.find((plugin) => plugin.defaultSequence !== undefined)?.defaultSequence;
  if (given !== undefined) return given;
  const first = sequences?.[0];
  if (first === undefined) return null;
  return (first.split("/").pop() ?? first).replace(/\.sequence\.json$/, "");
}

/** The project info of a manifest (or of the built-in one) in a folder. */
function infoOf(
  doc: Pick<ProjectDocument, "id" | "name">,
  workbench: WorkbenchSettings,
  dir: string,
  manifest: string | null,
  catalog: RunCatalog,
  sequence: string | null,
): ProjectInfo {
  return {
    id: doc.id,
    name: doc.name,
    dir,
    manifest,
    surfaces: workbench.surfaces.map(surfaceInfo),
    runs: Object.fromEntries(catalog.runs.map((run) => [run.id, run.command])),
    setup: workbench.setup ?? null,
    gate: catalog.gate?.command ?? null,
    contentRoots: [],
    denylist: [...(workbench.denylist ?? [])],
    credentialFile: workbench.credentialFile ?? DEFAULT_CREDENTIAL_FILE,
    theme: workbench.theme ?? null,
    defaultSequence: sequence,
  };
}

/** The built-in project of a checkout of this repository (no manifest file), with the built-in plugins. */
export function defaultProject(
  dir: string,
  checkout: string = dir,
  plugins: readonly HostPlugin[] = builtInPlugins(),
): HostProject {
  const workbench = defaultWorkbench(plugins);
  const runCatalog = projectRunCatalog(plugins, undefined, false);
  const sequence = defaultSequence(plugins, undefined);
  const info = infoOf({ id: "scenity-lab", name: "Scenity lab" }, workbench, dir, null, runCatalog, sequence);
  // The hash of the lab page (apps/editor `labsContentHash`) reads the same roots: the keys of the index agree.
  const base = baseOf(checkout, dir);
  const index = base === "" ? builtInIndexSource(plugins) : contentSource(projectContent({ workbench }, base));
  return { ...info, contentRoots: index.content.roots, content: index.content, index, plugins, runCatalog };
}

/**
 * Read the project of a folder. `checkout` is the root of the content hash (the Git worktree that holds the folder, or
 * the folder). A folder without `scenity.project.json` gets the built-in manifest; a bad manifest is an error that
 * names the file and the first problems, so the host does not start on a half-read project.
 */
export async function loadHostProject(folder: string, checkout: string = folder): Promise<HostProject> {
  const dir = resolve(folder);
  const file = join(dir, PROJECT_FILE);
  // A workspace with no manifest gets the plugins of the project that its package.json names.
  if (!existsSync(file)) return defaultProject(dir, checkout, workspacePlugins(dir));
  const loaded = await loadProject(dir, {
    readText: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  });
  if (!loaded.ok) {
    const problems = loaded.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    throw new Error(`The project manifest ${loaded.file} does not read: ${problems.join("; ")}`);
  }
  const { project } = loaded;
  // The host faces of the plugins of the project; a manifest with no workbench part gets their surfaces.
  const plugins = loadHostPlugins(dir, project.plugins ?? []);
  const workbench: WorkbenchSettings = project.workbench ?? pluginWorkbench(plugins);
  const content = projectContent(project, baseOf(checkout, dir));
  const index = projectIndexSource(dir, content);
  // The runs of the plugins and of the manifest, and the stop gate (`scenity check` by default).
  const runCatalog = projectRunCatalog(plugins, project.workbench, true);
  const info = infoOf(project, workbench, dir, file, runCatalog, defaultSequence(plugins, project.sequences));
  return { ...info, contentRoots: content.roots, content, index, plugins, runCatalog };
}

/** The ProjectInfo of a host project, without the content config (the shape of `host.hello`). */
export function projectInfo(project: HostProject): ProjectInfo {
  const { id, name, dir, manifest, surfaces, runs, setup, gate, contentRoots, denylist, credentialFile, theme } =
    project;
  const sequence = project.defaultSequence ?? null;
  const info = { id, name, dir, manifest, surfaces, runs, setup, gate, contentRoots, denylist, credentialFile, theme };
  return { ...info, defaultSequence: sequence };
}

/** The surface of the tools: the first surface with the capability `scene`, or null. */
export function sceneSurface(project: ProjectInfo): ProjectSurfaceInfo | null {
  return surfaceWith(project.surfaces);
}

/** The surfaces that the editor server of the host serves: the surfaces of the kind `scene`. */
export function editorSurfaces(project: ProjectInfo): ProjectSurfaceInfo[] {
  return project.surfaces.filter((surface) => surface.kind === SCENE_KIND);
}

/** The absolute path of the credential file of the project. */
export function credentialPath(project: ProjectInfo): string {
  return join(project.dir, project.credentialFile);
}
