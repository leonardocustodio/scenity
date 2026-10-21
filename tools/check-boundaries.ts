// SPDX-License-Identifier: Apache-2.0
/**
 * Check the package boundaries of the 3D room labs.
 *
 * Run from the repo root:
 *     bun tools/check-boundaries.ts    # exit 1 on a problem
 *
 * The tool reads the package.json of the workspace root, of each package under apps/ and packages/, and of each plugin
 * part under plugins/<plugin>/. A folder under plugins/<plugin>/ without a package.json can hold the parts one level
 * deeper: plugins/<plugin>/sdk/<name>.
 *
 * The rules name no plugin. One rule set applies to the parts of each plugin: the folder name of a part
 * (plugins/<plugin>/<face>) is its face, and a rule allows or refuses a face. The package names of a plugin start with
 * "@<scope>/<plugin>-", with any npm scope (for example "@acme/demo-room").
 * Rules:
 *     labs-app   no package depends on the labs app (@scenity/editor, apps/editor), but the studio host that runs it
 *     labs-sdk   only the labs app, the CLI check and the dev and editor faces of a plugin depend on the dev tools
 *                (@scenity/runtime-dev, packages/runtime-dev); only the labs app and the editor face of a plugin depend
 *                on the dev part of a plugin (plugins/<plugin>/dev)
 *     workbench-app   no package depends on the workbench page (@scenity/workbench, apps/workbench)
 *     workbench-host  only the workbench page depends on the workbench host (@scenity/workbench-host,
 *                     packages/workbench-host)
 *     engine-layer    an engine package depends only on the workspace packages of its layer (ENGINE_LAYERS,
 *                     docs/architecture.md)
 *     no-plugin       no engine package (apps/, packages/) depends on a plugin or a sample (plugins/, samples/),
 *                     except the users in PLUGIN_USERS
 *     labs-platform   only the lab page, the workbench page and the workbench host depend on the platform
 *                     capabilities (@scenity/labs-platform, packages/labs-platform); the host uses only its frame
 *                     key, content hash and index store
 *     bridge          only the two sides of the bridge depend on its contract (@scenity/bridge, packages/bridge):
 *                     the editor and the editor face of a plugin, the workbench page, the workbench host and the
 *                     host face of a plugin, and the CLI
 *
 * The tool reads the dependency names and the "file:", "link:" and "workspace:" paths. ESLint (eslint.config.js)
 * checks the import statements of the source files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const WEB_ROOT = resolve(import.meta.dir, "..");
/** The folders of the workspace packages (package.json "workspaces"). */
const PACKAGE_FOLDERS = ["apps", "packages"];
/**
 * The folders whose packages are one level deeper: plugins/<plugin>/<part>, or two levels in a group folder without
 * a package.json: plugins/<plugin>/<group>/<part>.
 */
const NESTED_FOLDERS = ["plugins"];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * A part of the labs and the packages that can depend on it. An engine part has a `name` and a `path`. A plugin part
 * has a `face` in their place: the rule applies to the part of that face of each plugin (plugins/<plugin>/<face>).
 */
type LabsPart = (
  | { readonly name: string; readonly path: string; readonly face?: undefined }
  | { readonly face: string; readonly name?: undefined; readonly path?: undefined }
) & {
  readonly rule: Rule;
  readonly users: readonly string[];
  /** The plugin parts (plugins/<plugin>/<face>) that can depend on it too, by the folder name of the part. */
  readonly faces?: readonly string[];
  readonly why: string;
};

export type Rule =
  | "labs-app"
  | "labs-sdk"
  | "workbench-app"
  | "workbench-host"
  | "labs-platform"
  | "bridge"
  | "engine-layer"
  | "no-plugin";

/**
 * The layer rules of the engine packages (docs/architecture.md): the folder name under packages/ and the workspace
 * packages that it can depend on. ESLint (ENGINE_LAYERS of eslint.config.js) checks the imports.
 */
export const ENGINE_LAYERS: Readonly<Record<string, readonly string[]>> = {
  scene: [],
  render: [],
  character: ["@scenity/scene"],
  runtime: ["@scenity/scene", "@scenity/render", "@scenity/character"],
  "runtime-dev": ["@scenity/scene", "@scenity/render", "@scenity/character", "@scenity/runtime", "@scenity/rules"],
  // The metric library (pure). The dev tools make its context, and the CLI runs its rules.
  rules: ["@scenity/scene", "@scenity/character"],
  "view-vue": ["@scenity/scene", "@scenity/runtime"],
  player: ["@scenity/scene", "@scenity/runtime", "@scenity/view-vue"],
  "editor-core": ["@scenity/scene", "@scenity/labs-platform"],
  bridge: [],
  assets: ["@scenity/scene", "@scenity/labs-platform"],
  // `scenity check` measures with the runtime and its dev tools. Only the entry `@scenity/cli/check` (the folder
  // src/check) imports them. ESLint keeps the other entries light.
  cli: [
    "@scenity/scene",
    "@scenity/labs-platform",
    "@scenity/assets",
    "@scenity/bridge",
    "@scenity/rules",
    "@scenity/runtime",
    "@scenity/runtime-dev",
    // `scenity build` (and the build of `shot`, `sheet`, `clip`, `bench` and the scene pool) runs the build
    // script of the player package (`@scenity/player/scripts/build.ts`, by its path at run time), so the CLI declares
    // the package. No source file of the CLI imports the player code.
    "@scenity/player",
  ],
};

/** The engine packages that can depend on a plugin, each with the reason. */
export const PLUGIN_USERS: Readonly<Record<string, string>> = {
  "@scenity/editor": "the editor faces of the plugins of a project",
};

const LABS_PARTS: readonly LabsPart[] = [
  {
    rule: "labs-app",
    name: "@scenity/editor",
    path: "apps/editor",
    // The studio host runs the scene server of the editor app as a child process (it imports no editor code).
    users: ["@scenity/studio-host"],
    // The editor face of a plugin implements the EditorPlugin of the editor (apps/editor/src/core). The command kit,
    // the runner, the ops and the history are in @scenity/editor-core. The face imports the Vue parts of the page (the
    // runner and editor composables, the tools, labUi, placeDrag, the interface).
    faces: ["editor"],
    why: "The labs app is for developers and agents only. No package depends on it, but the studio host (it runs the app) and the editor face of a plugin.",
  },
  // The dev tools of the runtime: the editor and the dev part of a plugin.
  {
    rule: "labs-sdk",
    name: "@scenity/runtime-dev",
    path: "packages/runtime-dev",
    // The headless rule check of `scenity check` (only the entry @scenity/cli/check; ESLint checks it).
    users: ["@scenity/editor", "@scenity/cli"],
    // The dev part of a plugin extends the dev tools. The editor face of a plugin reads them (its tests and its room
    // face for the editor core).
    faces: ["editor", "dev"],
    why: "Only the editor, the dev part and the editor face of a plugin and the check entry of the CLI use the dev tools. A player does not.",
  },
  // The dev part of each plugin: the dev extension of its room.
  {
    rule: "labs-sdk",
    face: "dev",
    users: ["@scenity/editor"],
    // The editor face of a plugin gives the metrics and the debug layers of its room to the editor core.
    faces: ["editor"],
    why: "Only the editor and the editor face of a plugin use the dev part of a plugin.",
  },
  // The labs workbench.
  {
    rule: "workbench-app",
    name: "@scenity/workbench",
    path: "apps/workbench",
    users: [],
    why: "The workbench page is a developer tool. No package depends on it.",
  },
  {
    rule: "workbench-host",
    name: "@scenity/workbench-host",
    path: "packages/workbench-host",
    users: ["@scenity/workbench"],
    // The host face of a plugin implements the HostPlugin of the host (its entry point /plugin).
    faces: ["host"],
    why: "Only apps/workbench (its entry point /protocol) and the host face of a plugin use the workbench host.",
  },
  // The platform capabilities of Scenity.
  {
    rule: "labs-platform",
    name: "@scenity/labs-platform",
    path: "packages/labs-platform",
    // The editor core hashes the scene files (`sha256`). The CLI makes the sheets (`rasterBun`)
    // and the WebM files (`webm`) of `scenity sheet` and `scenity clip`.
    users: ["@scenity/editor", "@scenity/editor-core", "@scenity/workbench", "@scenity/workbench-host", "@scenity/cli"],
    // The editor face of a plugin makes the frame key input of a labs command.
    faces: ["editor"],
    why: "Only apps/editor, apps/workbench, the workbench host and the editor face of a plugin use the platform capabilities of the labs.",
  },
  // The one contract of the bridge between the workbench page and a surface frame. The package itself is an
  // engine package with no workspace dependency (ENGINE_LAYERS).
  {
    rule: "bridge",
    name: "@scenity/bridge",
    path: "packages/bridge",
    // The agent tools are the host side of the bridge. The studio host runs them.
    users: [
      "@scenity/editor",
      "@scenity/workbench",
      "@scenity/workbench-host",
      "@scenity/cli",
      "@scenity/agent-tools",
      "@scenity/studio-host",
    ],
    // The editor face and the host face of each plugin define and send its typed calls.
    faces: ["editor", "host"],
    why: "Only the two sides of the bridge (the editor, the workbench page, the hosts and their plugin faces, the agent tools) and the CLI use the bridge contract. A runtime or a player does not.",
  },
];

export interface Problem {
  /** The package.json, relative to the workspace root. */
  readonly path: string;
  readonly rule: Rule;
  readonly message: string;
}

interface Manifest {
  readonly name?: string;
  readonly [field: string]: unknown;
}

/** Find the package.json of the workspace root and of each package folder, relative to the root. */
export function findManifests(root: string): string[] {
  const found = existsSync(join(root, "package.json")) ? ["package.json"] : [];
  for (const folder of PACKAGE_FOLDERS) {
    if (!existsSync(join(root, folder))) continue;
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = join(folder, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(join(root, path))) found.push(path);
    }
  }
  for (const folder of NESTED_FOLDERS) {
    if (!existsSync(join(root, folder))) continue;
    for (const plugin of readdirSync(join(root, folder), { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      for (const entry of readdirSync(join(root, folder, plugin.name), { withFileTypes: true })) {
        if (entry.isDirectory()) found.push(...partManifests(root, join(folder, plugin.name, entry.name)));
      }
    }
  }
  return found.sort();
}

/** The package.json of a plugin part, or of each part in a group folder (plugins/<plugin>/sdk/<name>). */
function partManifests(root: string, part: string): string[] {
  const path = join(part, "package.json");
  if (existsSync(join(root, path))) return [path];
  if (part.split("/").at(-1) === "node_modules") return [];
  return readdirSync(join(root, part), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, part, entry.name, "package.json")))
    .map((entry) => join(part, entry.name, "package.json"));
}

/** The plugins of the workspace: the folder names under plugins/ and the face of each package name of a part. */
interface Plugins {
  readonly folders: readonly string[];
  /** The package name of each part under plugins/ → the folder name of the part (its face). */
  readonly faces: ReadonlyMap<string, string>;
}

/** The plugins of the workspace, from the package.json files under plugins/. */
function pluginsOf(manifests: readonly (readonly [string, Manifest])[]): Plugins {
  const folders = new Set<string>();
  const faces = new Map<string, string>();
  for (const [path, manifest] of manifests) {
    const match = /^plugins\/([^/]+)\/([^/]+)\//.exec(path);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    folders.add(match[1]);
    if (manifest.name !== undefined) faces.set(manifest.name, match[2]);
  }
  return { folders: [...folders].sort(), faces };
}

/** The face of a plugin part that a dependency names (by package name or by path), or undefined. */
function faceOf(name: string, target: string | undefined, plugins: Plugins): string | undefined {
  const byPath = target === undefined ? undefined : /^plugins\/[^/]+\/([^/]+)$/.exec(target)?.[1];
  if (byPath !== undefined) return byPath;
  const known = plugins.faces.get(name);
  if (known !== undefined) return known;
  const prefix = pluginPrefix(name, plugins);
  return prefix === undefined ? undefined : unscoped(name)?.slice(`${prefix}-`.length);
}

/** The name of a scoped package without its scope ("@acme/demo-room" gives "demo-room"), or undefined. */
function unscoped(name: string): string | undefined {
  return /^@[^/]+\/(.+)$/.exec(name)?.[1];
}

/**
 * The plugin folder whose prefix starts a package name: "@<scope>/<plugin>-" with any npm scope, or undefined. A
 * plugin is not bound to the scope of the engine: the project document can name a package of each scope.
 */
function pluginPrefix(name: string, plugins: Plugins): string | undefined {
  const bare = unscoped(name);
  return bare === undefined ? undefined : plugins.folders.find((folder) => bare.startsWith(`${folder}-`));
}

/**
 * True for a dependency on a plugin or a sample: a path under plugins/ or samples/, a name with the prefix of a
 * plugin ("@<scope>/<plugin>-"), or the name of a package under plugins/ (the SDK chain of an external engine keeps
 * its own names in plugins/<plugin>/sdk).
 */
function isPluginDependency(name: string, target: string | undefined, plugins: Plugins): boolean {
  if (target !== undefined && /^(plugins|samples)(\/|$)/.test(target)) return true;
  return plugins.faces.has(name) || pluginPrefix(name, plugins) !== undefined;
}

/** The problems of the layer rules for one dependency of one package.json. */
function layerProblems(
  path: string,
  owner: string,
  dependency: { readonly name: string; readonly target: string | undefined },
  plugins: Plugins,
): Problem[] {
  const { name, target } = dependency;
  const problems: Problem[] = [];
  const engine = /^(apps|packages)\//.test(path);
  if (engine && isPluginDependency(name, target, plugins) && PLUGIN_USERS[owner] === undefined)
    problems.push({
      path,
      rule: "no-plugin",
      message: `${owner} depends on the plugin ${name}. No engine package depends on a plugin.`,
    });
  const layer = /^packages\/([^/]+)\/package\.json$/.exec(path)?.[1];
  const allowed = layer === undefined ? undefined : ENGINE_LAYERS[layer];
  if (allowed !== undefined && name.startsWith("@scenity/") && !allowed.includes(name))
    problems.push({
      path,
      rule: "engine-layer",
      message: `${owner} depends on ${name}; its layer allows ${allowed.length === 0 ? "no workspace package" : allowed.join(", ")}.`,
    });
  return problems;
}

/** Give the folder (relative to the root) that a "file:", "link:" or "workspace:" path points to, or undefined. */
function pathTarget(root: string, manifest: string, spec: string): string | undefined {
  const match = /^(?:file|link|workspace):(\.{1,2}\/.*)$/.exec(spec);
  if (match?.[1] === undefined) return undefined;
  return relative(root, resolve(root, manifest, "..", match[1]));
}

function dependenciesOf(manifest: Manifest): [string, string][] {
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const value = manifest[field];
    if (typeof value !== "object" || value === null) return [];
    return Object.entries(value as Record<string, unknown>).map(([name, spec]): [string, string] => [
      name,
      typeof spec === "string" ? spec : "",
    ]);
  });
}

/** Check each package.json of the workspace against the labs boundaries. */
export function checkBoundaries(root: string = WEB_ROOT): Problem[] {
  const problems: Problem[] = [];
  const manifests = findManifests(root).map((path): [string, Manifest] => [
    path,
    JSON.parse(readFileSync(join(root, path), "utf8")) as Manifest,
  ]);
  const plugins = pluginsOf(manifests);
  for (const [path, manifest] of manifests) {
    const owner = manifest.name ?? path;
    for (const [name, spec] of dependenciesOf(manifest)) {
      const target = pathTarget(root, path, spec);
      problems.push(...layerProblems(path, owner, { name, target }, plugins));
      const face = /^plugins\/[^/]+\/([^/]+)\/package\.json$/.exec(path)?.[1];
      const dependencyFace = faceOf(name, target, plugins);
      for (const part of LABS_PARTS) {
        if (owner === (part.name ?? name) || part.users.includes(owner)) continue;
        if (face !== undefined && part.faces?.includes(face) === true) continue;
        const hit = part.face === undefined ? name === part.name || target === part.path : dependencyFace === part.face;
        if (!hit) continue;
        const what =
          part.face === undefined ? `${part.name} (${part.path})` : `${name}, the ${part.face} part of a plugin`;
        problems.push({ path, rule: part.rule, message: `${owner} depends on ${what}. ${part.why}` });
      }
    }
  }
  return problems;
}

function main(): number {
  const problems = checkBoundaries();
  for (const problem of problems) {
    process.stdout.write(`${problem.path}: [${problem.rule}] ${problem.message}\n`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `boundaries: ${String(problems.length)} problem(s). Remove the dependency, or move the code that needs the ` +
        "labs into apps/editor.\n",
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
