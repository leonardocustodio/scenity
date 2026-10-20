// SPDX-License-Identifier: Apache-2.0
/**
 * The player step of `scenity build`: the Vite build of the player entries of `@scenity/player`
 * (`packages/player/scripts/build.ts`) with the plugin bundle of the project (`scenityPlugins`). The entry `plugins` is
 * `virtual:scenity/plugins`: one chunk for each runtime plugin of the project, and no plugin code for a project with no
 * plugin. The page and the worker builds both get the Vite plugin.
 *
 * The step also gives the file groups of the entries for the size budgets:
 *
 * - `player`: `index.js` (the JavaScript API) and its static imports;
 * - `element`: `element.js` (the web component) and its static imports;
 * - `worker`: the generic scene worker and its static imports;
 * - `plugins`: `plugins.js` and the chunks of the plugins that it loads, with no file of the groups above and no file
 *   that the player entries load lazily (a plugin chunk shares the three.js chunk of the main-thread cores);
 * - `lazy`: each other script (the main-thread cores, the decoders, the effects).
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PLUGINS_MODULE, scenityPlugins } from "../vite/plugins";
import { packageDir } from "../vite/resolve";
import { closure, edgeReader, type BuiltFile } from "./sizes";

/** The options of `buildPlayer` of the player package (the build script is not a module of this package). */
interface PlayerBuildModule {
  buildPlayer(options: {
    readonly out: string;
    readonly plugins?: readonly unknown[];
    readonly inputs?: Readonly<Record<string, string>>;
    readonly base?: string;
    readonly sourcemap?: boolean | "hidden";
    readonly logLevel?: "warn" | "error";
  }): Promise<void>;
}

/** The IDs and the labels of the entries of a player build. */
export const PLAYER_ENTRIES: readonly { readonly id: string; readonly label: string }[] = [
  { id: "player", label: "player entry (index.js and its static imports)" },
  { id: "element", label: "web component entry (element.js and its static imports)" },
  { id: "worker", label: "generic scene worker (and its static imports)" },
  { id: "plugins", label: "plugin bundle (plugins.js and the plugin chunks)" },
  { id: "lazy", label: "lazy chunks (main-thread cores, decoders, effects)" },
];

/** Build the player entries of a project into `out` (with hidden source maps for the marker gate). */
export async function buildPlayerEntries(projectDir: string, out: string): Promise<void> {
  const dir = packageDir("@scenity/player", import.meta.dir);
  const script = pathToFileURL(join(dir, "scripts", "build.ts")).href;
  const module = (await import(script)) as PlayerBuildModule;
  await module.buildPlayer({
    out,
    base: "./",
    sourcemap: "hidden",
    // The warnings of Vite (the size of a chunk, a Node module of a decoder) are not results of the build.
    logLevel: "error",
    plugins: [scenityPlugins({ project: projectDir })],
    inputs: { plugins: PLUGINS_MODULE },
  });
}

/** The file groups of the entries of a player build in `dir`, by the entry ID; the problems go into `problems`. */
export function playerGroups(
  dir: string,
  build: ReadonlyMap<string, BuiltFile>,
  problems: string[],
): Record<string, string[]> {
  const edgesOf = edgeReader(dir, build);
  const scripts = [...build.keys()].filter((path) => /\.(js|mjs)$/.test(path));
  const group = (start: string | undefined, lazy = false, stop: ReadonlySet<string> = new Set()): string[] => {
    if (start === undefined || !build.has(start)) {
      problems.push(`the player build has no ${start ?? "generic scene worker"}`);
      return [];
    }
    const result = closure([start], edgesOf, lazy, stop);
    for (const path of result.missing) problems.push(`${start} imports ${path}, but the build has no such file`);
    return [...result.files].filter((path) => /\.(js|mjs)$/.test(path)).sort();
  };
  const player = group("index.js");
  const element = group("element.js");
  const worker = group(scripts.find((path) => /(^|\/)sceneWorker-[^/]+\.js$/.test(path)));
  const known = new Set([...player, ...element, ...worker]);
  // The main-thread cores of the entries also load these files, so they count in `lazy`.
  const withCores = closure(["index.js", "element.js"], edgesOf, true, new Set(["plugins.js"])).files;
  const plugins = group("plugins.js", true, new Set([...known, ...withCores]));
  for (const path of plugins) known.add(path);
  const lazy = scripts.filter((path) => !known.has(path)).sort();
  return { player, element, worker, plugins, lazy };
}
