// SPDX-License-Identifier: Apache-2.0
/**
 * The marker gate of a release build. A release build holds no editor, no dev tools and no lab code.
 * The gate reads each script and each source map of a build folder:
 *
 * - a marker is a string that only dev code puts in a script: a message of the lab or of the dev scene worker, the
 *   lab script API, a debug group name, a motion metric name of a plugin. Kind `lab`: dev code, a failure; when a
 *   labs build is given, a `lab` marker that the labs build does not hold makes the list stale (a failure too). Kind
 *   `dev`: a failure, with no stale check. Kind `info`: information only (for example a tune key of the runtime);
 * - a module marker is a pattern of a module path in a source map: the dev packages of the engine, the editor app,
 *   and the dev parts of a plugin. Code of a plugin or a sample that the project does not list is a failure too.
 *
 * The engine gives `engineMarkers()`. A plugin of the project adds its markers in its markers face (plugins.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type MarkerKind = "lab" | "dev" | "info";

export interface Marker {
  /** The marker as the report shows it. */
  readonly id: string;
  readonly kind: MarkerKind;
  /** What the marker shows. */
  readonly what: string;
  readonly pattern: RegExp;
}

/** A pattern of a module path (with "/") in the `sources` of a source map. */
export interface ModuleMarker {
  readonly id: string;
  readonly what: string;
  readonly pattern: RegExp;
  /** True: a module inside the folder of a plugin of the project passes. */
  readonly listedPluginsPass?: boolean;
}

/** The markers of a gate. */
export interface MarkerSet {
  readonly markers: readonly Marker[];
  readonly modules: readonly ModuleMarker[];
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A quoted string in the minified code: "x", 'x' or `x`. */
export function quoted(text: string): RegExp {
  return new RegExp(`["'\`]${escape(text)}["'\`]`);
}

/** A group name or a reply of the lab: a quoted string. */
function labString(id: string, what: string): Marker {
  return { id, kind: "lab", what, pattern: quoted(id) };
}

/** A global name or a method name of the lab: a word. */
function labWord(id: string, what: string): Marker {
  return { id, kind: "lab", what, pattern: new RegExp(`\\b${escape(id)}\\b`) };
}

/** The lab markers of the editor and its dev tools. */
function labMarkers(): Marker[] {
  const messages = ["mark", "inspect", "debug", "tune"].map((type) => ({
    id: `case "${type}"`,
    kind: "lab" as const,
    what: "a lab message case of the render worker",
    pattern: new RegExp(`case\\s*["'\`]${type}["'\`]`),
  }));
  return [
    ...messages,
    labString("inspected", "the inspect reply of the lab"),
    labString("debug-layers", "the debug layers of the lab"),
    { id: "__room3dLab", kind: "lab", what: "the lab script API", pattern: /__room3dLab/ },
    labWord("setTunes", "the tune method of the renderer"),
    labWord("setDebug", "the debug method of the renderer"),
    // The workbench bridge of the lab page: `globalThis.__workbench`.
    { id: "__workbench", kind: "lab", what: "the workbench bridge of the lab", pattern: /__workbench\b/ },
    // The import preview and the scratch props of the lab page.
    { id: "__labImport", kind: "lab", what: "the import preview of the lab", pattern: /__labImport\b/ },
    { id: "__labScratch", kind: "lab", what: "the scratch props of the lab page", pattern: /__labScratch\b/ },
    labString("lab-scratch-props", "the scratch props of the labs core"),
    // The ghosts of the proposals, the editor overlay and the onion skin.
    labString("lab-proposal-ghosts", "the ghosts of the proposals of the labs core"),
    labString("lab-editor-overlay", "the editor overlay of the labs core"),
    labString("lab-onion-skin", "the onion skin of the labs core"),
    // The solo and hide of the panes: the worker message of the labs renderer.
    labString("paneHide", "the solo and hide of the panes of the labs core"),
    // The timed prop places of a lab take: a field of the scene input that the labs core reads.
    labWord("labProps", "the timed prop places of the labs core"),
  ];
}

/** The messages of the dev scene worker: a release build never sends or answers them. */
export const DEV_MESSAGES: readonly string[] = ["inspectScene", "sceneInspected", "checkRules", "rulesChecked"];

/** The dev packages of the engine and the editor app: a release build holds no module of them. */
const DEV_MODULES: readonly (readonly [string, string])[] = [
  ["runtime-dev", "the dev tools of the runtime"],
  ["editor-core", "the editor core"],
  ["bridge", "the bridge of the editor and the host"],
  ["workbench-host", "the workbench host"],
  ["labs-platform", "the platform of the labs"],
  ["room3d-labs", "the facade of the labs"],
  ["rules", "the rules"],
  ["cli", "the command line tools"],
  ["assets", "the asset tools"],
];

/** The markers of the engine: the lab markers, the messages of the dev scene worker and the dev module paths. */
export function engineMarkers(): MarkerSet {
  const messages = DEV_MESSAGES.map((message) => ({
    id: message,
    kind: "dev" as const,
    what: "a message of the dev scene worker",
    pattern: quoted(message),
  }));
  const modules: ModuleMarker[] = DEV_MODULES.map(([name, what]) => ({
    id: `packages/${name}`,
    what,
    // An installed package has the path `node_modules/@scenity/<name>/`.
    pattern: new RegExp(`/(packages|node_modules/@scenity)/${escape(name)}/`),
  }));
  modules.push(
    // The installed editor has the path `node_modules/@scenity/editor/`.
    { id: "apps", what: "an app (the editor, the workbench)", pattern: /\/(apps|node_modules\/@scenity\/editor)\// },
    {
      id: "plugins",
      what: "code of a plugin or a sample that the project does not list",
      // The plugin host of an engine package (`packages/runtime/src/plugins/`) is engine code. The same is true for
      // an installed package (`node_modules/@scenity/runtime/src/plugins/`).
      pattern: /^(?!.*\/(packages|node_modules\/@scenity)\/[^/]+\/src\/).*\/(plugins|samples)\//,
      listedPluginsPass: true,
    },
  );
  return { markers: [...labMarkers(), ...messages], modules };
}

/** Join marker sets in their order. */
export function joinMarkerSets(...sets: readonly MarkerSet[]): MarkerSet {
  return { markers: sets.flatMap((set) => set.markers), modules: sets.flatMap((set) => set.modules) };
}

/** The files of a build folder with an extension, relative to it with "/". */
function filesOf(dir: string, test: (name: string) => boolean, folder = ""): string[] {
  return readdirSync(join(dir, folder), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) return filesOf(dir, test, path);
      return test(entry.name) ? [path] : [];
    });
}

export interface MarkerFinding {
  readonly marker: Marker;
  readonly files: readonly string[];
}

/** The markers in the scripts of a build folder, each with its files. */
export function scanMarkers(dir: string, markers: readonly Marker[]): MarkerFinding[] {
  const texts = filesOf(dir, (name) => /\.(js|mjs)$/.test(name)).map(
    (path) => [path, readFileSync(join(dir, path), "utf8")] as const,
  );
  return markers
    .map((marker) => ({ marker, files: texts.filter(([, text]) => marker.pattern.test(text)).map(([path]) => path) }))
    .filter((finding) => finding.files.length > 0);
}

export interface ModuleFinding {
  readonly module: ModuleMarker;
  /** The source map that names the module. */
  readonly file: string;
  /** The module path as the source map gives it. */
  readonly source: string;
}

/** True when `path` is inside one of the folders (absolute paths). */
function inside(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep));
}

/**
 * The absolute path of a source of a source map. Vite writes the sources of a worker map relative to another folder
 * than the map folder, so the function tries the map folder and then each folder above it, and takes the first path
 * that exists. A source that exists nowhere (a virtual module) gives its path with no leading "../".
 */
function sourcePath(mapDir: string, source: string, bases: readonly string[] = []): string {
  if (isAbsolute(source)) return source;
  // The bundle of a worker names its sources from another folder (the output folder of its own build).
  for (const base of bases) {
    const path = resolve(base, source);
    if (existsSync(path)) return path;
  }
  for (let dir = mapDir; ; dir = dirname(dir)) {
    const path = resolve(dir, source);
    if (existsSync(path)) return path;
    if (dirname(dir) === dir) break;
  }
  return resolve("/", source.replace(/^(\.\.?\/)+/, ""));
}

/** The source of a virtual module of Vite in a source map (`__vite-browser-external`, a `\0` ID). */
const VIRTUAL_SOURCE = /(^|\/)(__vite-browser-external|\0)/;

/**
 * The module markers in the source maps of a build folder. `pluginDirs` are the folders of the plugins of the
 * project (absolute): a module in them passes a marker with `listedPluginsPass`.
 */
export function scanModules(
  dir: string,
  modules: readonly ModuleMarker[],
  pluginDirs: readonly string[] = [],
  bases: readonly string[] = [],
): ModuleFinding[] {
  const findings: ModuleFinding[] = [];
  for (const map of filesOf(dir, (name) => name.endsWith(".map"))) {
    const { sources = [] } = JSON.parse(readFileSync(join(dir, map), "utf8")) as { sources?: string[] };
    for (const source of sources) {
      // A virtual module of the bundler (the shim of a Node module of a decoder) is not a file of a package.
      if (VIRTUAL_SOURCE.test(source)) continue;
      const absolute = sourcePath(join(dir, dirname(map)), source, bases);
      const path = absolute.split(sep).join("/");
      for (const module of modules) {
        if (!module.pattern.test(path)) continue;
        if (module.listedPluginsPass === true && inside(absolute, pluginDirs)) continue;
        findings.push({ module, file: map, source });
      }
    }
  }
  return findings;
}

/** The result of the gate. */
export interface MarkerGate {
  /** The `lab` and `dev` markers of the build: each one is a failure. */
  readonly found: readonly MarkerFinding[];
  /** The `info` markers of the build. */
  readonly info: readonly MarkerFinding[];
  /** The dev modules of the source maps: each one is a failure. */
  readonly modules: readonly ModuleFinding[];
  /** The `lab` markers that the labs build does not hold, or null with no labs build. */
  readonly stale: readonly Marker[] | null;
}

export interface GateOptions {
  /** A labs build (the editor) that holds the lab code on purpose: each `lab` marker must be in it. */
  readonly labsDir?: string | null;
  /** The folders of the plugins of the project (absolute). */
  readonly pluginDirs?: readonly string[];
  /** More folders that the relative sources of the source maps can start from (absolute). */
  readonly sourceBases?: readonly string[];
}

/** Scan a build folder, and the labs build when one is given. */
export function markerGate(dir: string, set: MarkerSet, options: GateOptions = {}): MarkerGate {
  const found = scanMarkers(dir, set.markers);
  const labsDir = options.labsDir ?? null;
  const lab = set.markers.filter((marker) => marker.kind === "lab");
  const inLabs =
    labsDir === null || !existsSync(labsDir) ? null : new Set(scanMarkers(labsDir, lab).map((item) => item.marker.id));
  return {
    found: found.filter((item) => item.marker.kind !== "info"),
    info: found.filter((item) => item.marker.kind === "info"),
    modules: scanModules(dir, set.modules, options.pluginDirs, options.sourceBases),
    stale: inLabs === null ? null : lab.filter((marker) => !inLabs.has(marker.id)),
  };
}

/** True when the gate fails: a dev marker or a dev module in the build, or a stale marker list. */
export function gateFails(gate: MarkerGate): boolean {
  return gate.found.length > 0 || gate.modules.length > 0 || (gate.stale?.length ?? 0) > 0;
}

/** The result of the gate as text lines. */
export function formatGate(gate: MarkerGate): string[] {
  const line = (item: MarkerFinding): string =>
    `  ${item.marker.id.padEnd(22)} ${item.marker.what}: ${item.files.join(", ")}`;
  const lines =
    gate.found.length === 0
      ? ["markers: no dev or lab marker in the build"]
      : [
          `markers: ${String(gate.found.length)} dev or lab markers in the build: a release has none`,
          ...gate.found.map(line),
        ];
  if (gate.modules.length === 0) lines.push("modules: no dev module in the source maps");
  else {
    lines.push(`modules: ${String(gate.modules.length)} dev modules in the source maps`);
    for (const item of gate.modules) lines.push(`  ${item.module.id.padEnd(22)} ${item.file}: ${item.source}`);
  }
  if (gate.info.length > 0) {
    lines.push(`information: ${String(gate.info.length)} info markers in the build (no failure)`);
  }
  if (gate.stale !== null) {
    lines.push(
      gate.stale.length === 0
        ? "lab markers of the labs build: each one is there"
        : `lab markers of the labs build: ${String(gate.stale.length)} not there, so the list is stale: ${gate.stale.map((marker) => marker.id).join(", ")}`,
    );
  }
  return lines;
}
