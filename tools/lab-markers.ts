// SPDX-License-Identifier: Apache-2.0
/**
 * The lab marker scan of a runtime build of the 3D room.
 *
 * The gate is generic (`packages/cli/src/build/markers.ts`). `scenity build` runs it on each project build. This tool
 * gives it the markers of the engine and the markers face of each plugin part (for a room: the motion metric names
 * and the tune keys). The tool finds the faces (`scenity.markers` of a part, else its `markers.ts`) and names no
 * plugin.
 *
 *   bun tools/lab-markers.ts --dist <dir> [--labs <dir>]
 *
 * The gate: a lab marker in the runtime build fails, and so does a lab marker that the labs build does not have (the
 * list is stale). `bun run check:size --dist <dir>` runs the gate on the runtime build in `<dir>`. It also runs the
 * gate on the labs build when one exists (`apps/editor/dist`, from `bun run --filter @scenity/editor build`).
 * `--dist` has no default.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  engineMarkers,
  formatGate,
  gateFails,
  joinMarkerSets,
  markerGate as gateOf,
  scanMarkers,
  type Marker,
  type MarkerGate,
} from "../packages/cli/src/build/markers";
import { markersFace, readMarkerFace } from "../packages/cli/src/build/plugins";

export { formatGate, gateFails, scanMarkers, type Marker, type MarkerGate };

/** The folder of each plugin part (plugins/<plugin>/<part>), sorted. */
function pluginParts(root: string): string[] {
  const plugins = join(root, "plugins");
  if (!existsSync(plugins)) return [];
  const folders = (dir: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => join(dir, entry.name))
      .sort();
  return folders(plugins).flatMap(folders);
}

/** The markers faces of the plugin parts, read once at the module load. */
const PLUGIN_FACES = await Promise.all(
  pluginParts(join(import.meta.dir, ".."))
    .flatMap((dir) => markersFace(dir) ?? [])
    .map(async (file) => {
      const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
      return readMarkerFace(module.default, file);
    }),
);

/** The markers of a runtime build of the room: the markers of the engine and of each plugin face. */
export function labMarkers(): Marker[] {
  return [...joinMarkerSets(engineMarkers(), ...PLUGIN_FACES).markers];
}

/** The build of the labs app, or null when there is none. */
export function defaultLabsDist(): string | null {
  const dist = join(import.meta.dir, "..", "apps", "editor", "dist");
  return existsSync(dist) ? dist : null;
}

/** Scan the runtime build for the markers (no module paths: a runtime build of the room has no source maps). */
export function markerGate(
  dist: string,
  labsDist: string | null,
  markers: readonly Marker[] = labMarkers(),
): MarkerGate {
  return gateOf(dist, { markers, modules: [] }, { labsDir: labsDist });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--dist");
  if (at < 0) {
    console.error("lab markers: give the runtime build with --dist <dir> (no default build folder)");
    process.exit(1);
  }
  const dist = resolve(args[at + 1] ?? "");
  if (!existsSync(dist)) {
    console.error(`lab markers: no build at ${dist}`);
    process.exit(1);
  }
  const labs = args.indexOf("--labs");
  const labsDist = labs >= 0 ? resolve(args[labs + 1] ?? "") : defaultLabsDist();
  const gate = markerGate(dist, labsDist);
  console.log(formatGate(gate).join("\n"));
  if (gateFails(gate)) process.exit(1);
}
