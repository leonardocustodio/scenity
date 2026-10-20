// SPDX-License-Identifier: Apache-2.0
/**
 * The dependency step of the scene page dev server.
 *
 * In a checkout the packages are workspace links: Vite reads them as source. An installed editor finds them in
 * `node_modules`, and Vite then bundles them in its dependency step. That step fails on their worker imports
 * (`?worker&url`) and their virtual modules (`virtual:scenity/plugins`). So the config leaves each Scenity package out
 * of the dependency step (`optimizeDeps.exclude`): Vite serves them as source, as in the checkout.
 *
 * The scan of the dependency step does not read an excluded package. Thus the scan does not find the packages that
 * only the Scenity packages import (three.js, zod, Fluent, reka-ui). Without a list, Vite finds them on the first page load,
 * bundles them again and reloads the page. A reload removes the unsaved edits of the edit mode. So the config names these
 * packages in `optimizeDeps.include` (`sceneDependencies`), and the first bundle holds them all.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SCOPE = "@scenity/";

/**
 * The modules that the scene page, its worker and its lazy chunks (the edit mode, the effects) import from packages
 * outside the Scenity scope. Keep the list equal to the imports: the spec `scene-first-load.spec.ts` fails when
 * the first load of the edit mode makes Vite bundle a new module.
 */
export const SCENE_PAGE_MODULES = [
  "vue",
  "zod",
  "@fluent/bundle",
  "@fluent/langneg",
  "fluent-vue",
  "@vueuse/core",
  "class-variance-authority",
  "clsx",
  "lucide-vue-next",
  "reka-ui",
  "tailwind-merge",
  "three",
  "three/tsl",
  "three/webgpu",
  "three/examples/jsm/libs/meshopt_decoder.module.js",
  "three/examples/jsm/loaders/HDRLoader.js",
  "three/examples/jsm/loaders/KTX2Loader.js",
  "three/examples/jsm/math/SimplexNoise.js",
  "three/examples/jsm/postprocessing/EffectComposer.js",
  "three/examples/jsm/postprocessing/FXAAPass.js",
  "three/examples/jsm/postprocessing/GTAOPass.js",
  "three/examples/jsm/postprocessing/OutlinePass.js",
  "three/examples/jsm/postprocessing/OutputPass.js",
  "three/examples/jsm/postprocessing/Pass.js",
  "three/examples/jsm/postprocessing/RenderPass.js",
  "three/examples/jsm/postprocessing/SMAAPass.js",
  "three/examples/jsm/postprocessing/UnrealBloomPass.js",
  "three/examples/jsm/shaders/SMAAShader.js",
  "three/examples/jsm/tsl/display/BloomNode.js",
  "three/examples/jsm/tsl/display/FXAANode.js",
  "three/examples/jsm/tsl/display/GTAONode.js",
  "three/examples/jsm/tsl/display/OutlineNode.js",
  "three/examples/jsm/tsl/display/SMAANode.js",
  "three/examples/jsm/utils/BufferGeometryUtils.js",
  "three/examples/jsm/utils/SkeletonUtils.js",
] as const;

/** The package.json of a package name, from the `node_modules` folders above a folder, or null. */
function manifestOf(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

/** The names of the dependencies and the peer dependencies of a package.json. */
function dependencies(file: string): string[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
  return Object.keys({ ...data.dependencies, ...data.peerDependencies });
}

/** The package.json of each Scenity package that `manifest` needs, direct or through another one, by name. */
function scenityManifests(manifest: string): Map<string, string> {
  const found = new Map<string, string>();
  const queue = [manifest];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const name of dependencies(file).filter((each) => each.startsWith(SCOPE))) {
      if (found.has(name)) continue;
      const next = manifestOf(name, dirname(file));
      found.set(name, next ?? "");
      if (next !== null) queue.push(next);
    }
  }
  return found;
}

/** Each Scenity package that the package.json `manifest` needs, direct or through another Scenity package, sorted. */
export function scenityPackages(manifest: string): string[] {
  return [...scenityManifests(manifest).keys()].sort();
}

/** The package name of a module ID (`three/tsl` gives `three`, `@fluent/bundle` gives `@fluent/bundle`). */
function packageOf(id: string): string {
  const parts = id.split("/");
  return (id.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/**
 * The `optimizeDeps.include` entries of the scene page for the package.json `manifest` of the editor. A module of a
 * package that the editor declares keeps its ID. A module of a package that only a Scenity package declares gets the
 * nested form `<scenity package> > <id>`: Vite then finds it from that package, also in a strict `node_modules` tree.
 * The entries have no module of a package that no manifest declares.
 */
export function sceneDependencies(manifest: string, modules: readonly string[] = SCENE_PAGE_MODULES): string[] {
  const own = new Set(dependencies(manifest));
  const owners = [...scenityManifests(manifest)].filter(([, file]) => file !== "");
  return modules.flatMap((id) => {
    const name = packageOf(id);
    if (own.has(name)) return [id];
    const owner = owners.find(([, file]) => dependencies(file).includes(name));
    return owner === undefined ? [] : [`${owner[0]} > ${id}`];
  });
}
