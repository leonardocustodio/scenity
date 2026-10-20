// SPDX-License-Identifier: Apache-2.0
/**
 * The Vite build of the player entries: `index` (the JavaScript API), `element` (the web component) and the generic
 * scene worker that they load.
 *
 * The release checks (the marker gate and the size budgets) are in `scenity build` (`packages/cli/src/build`). The
 * command finds this package in the workspace, calls `buildPlayer` with the plugin bundle of the project, and checks
 * the output.
 *
 *     bun packages/player/scripts/build.ts [--out <dir>]     (default packages/player/dist)
 */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { build, type InlineConfig, type Plugin, type PluginOption } from "vite";

export const PACKAGE_DIR = resolve(import.meta.dir, "..");
export const DEFAULT_OUT = join(PACKAGE_DIR, "dist");

export interface PlayerBuildOptions {
  /** The output folder. The build empties it first. */
  readonly out: string;
  /** More Vite plugins for the page and the worker builds (for example the project plugins). */
  readonly plugins?: readonly PluginOption[];
  /** More entries: the output name and the module ID (for example `virtual:scenity/plugins`). */
  readonly inputs?: Readonly<Record<string, string>>;
  /** The public base of the files (default "/"; "./" gives a build for any folder of a server). */
  readonly base?: string;
  /** The source maps: true writes them with a link, "hidden" with no link. */
  readonly sourcemap?: boolean | "hidden";
  /** The log level of Vite (default "warn"). */
  readonly logLevel?: "warn" | "error";
}

/** The plugin module of the build. */
const PLUGINS_MODULE = "virtual:scenity/plugins";

/**
 * The plugin module of a build with no project plugins: no plugin. The player and its worker import the module. A
 * project build gives it first (`scenityPlugins` of `@scenity/cli/vite`), so this plugin comes last.
 */
function noProjectPlugins(): Plugin {
  return {
    name: "scenity:no-project-plugins",
    resolveId: (id) => (id === PLUGINS_MODULE ? `\0${PLUGINS_MODULE}` : undefined),
    load: (id) =>
      id === `\0${PLUGINS_MODULE}`
        ? "export const pluginKeys = [];\nexport async function loadPlugins() {\n  return [];\n}\n"
        : undefined,
  };
}

/** The Vite configuration of the player entries. */
export function playerBuildConfig(options: PlayerBuildOptions): InlineConfig {
  const plugins = [...(options.plugins ?? []), noProjectPlugins()];
  return {
    configFile: false,
    root: PACKAGE_DIR,
    base: options.base ?? "/",
    logLevel: options.logLevel ?? "warn",
    plugins,
    // The generic scene worker imports the Draco decoder as a chunk, and an IIFE worker has no chunks.
    worker: { format: "es", plugins: () => [...plugins] },
    build: {
      outDir: options.out,
      emptyOutDir: true,
      target: "es2023",
      sourcemap: options.sourcemap ?? true,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          index: join(PACKAGE_DIR, "src/index.ts"),
          element: join(PACKAGE_DIR, "src/element.ts"),
          ...options.inputs,
        },
        // The entries keep their exports, so the API of `index` is in the build.
        preserveEntrySignatures: "exports-only",
        output: { entryFileNames: "[name].js" },
      },
    },
  };
}

/** Build the player entries into `out` (a folder), or with the options of `scenity build`. */
export async function buildPlayer(target: string | PlayerBuildOptions = DEFAULT_OUT): Promise<void> {
  const options = typeof target === "string" ? { out: target } : target;
  rmSync(options.out, { recursive: true, force: true });
  await build(playerBuildConfig(options));
}

if (import.meta.main) {
  const at = process.argv.indexOf("--out");
  const out = at >= 0 ? resolve(process.argv[at + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
  await buildPlayer(out);
  console.log(`player: built ${out}; run scenity build for the release checks`);
}
