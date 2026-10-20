// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the items of the content browser (`<folder>/<name>.webp`) as one module. The virtual module
 * `virtual:labs-stills` gives the URL of each picture by its name. The editor plugin of the project gives the folder
 * (vite.config.ts).
 *
 * An eager `import.meta.glob` of the pictures with `?url` makes one module per picture, and the dev server serves each
 * module before the load event of the lab page. With about 350 pictures that adds about 50 ms to each page start
 * (`start.httpCold.navigation`). Thus the dev server gives one module with the paths of the files. It serves each
 * picture as a static file when a tile shows it. The build imports each picture with `?url`, as a glob does, so the
 * build has the same assets.
 *
 * The dev server sends an update of the module when a picture is added, changed or removed (`bun run labs stills`).
 * The modification time is in each URL, so a new picture of a name is a new URL.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

export const STILLS_MODULE = "virtual:labs-stills";
const RESOLVED = `\0${STILLS_MODULE}`;

/** The file names of the pictures in a folder, sorted. */
function pictures(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".webp"))
      .sort();
  } catch {
    return [];
  }
}

/** The name of a picture: its file name without `.webp`. */
function nameOf(file: string): string {
  return file.replace(/\.webp$/, "");
}

/** The code of the module of the build: an import with `?url` for each picture. */
export function buildModule(dir: string, files: readonly string[]): string {
  const lines = files.map(
    (file, index) => `import p${String(index)} from ${JSON.stringify(`${join(dir, file)}?url`)};`,
  );
  const entries = files.map((file, index) => `  ${JSON.stringify(nameOf(file))}: p${String(index)},`);
  return `${lines.join("\n")}\nexport default {\n${entries.join("\n")}\n};\n`;
}

/**
 * The code of the module of the dev server: the URL of each picture. The server serves a file under the root at its
 * path under the base, and another file through `/@fs/`.
 */
export function devModule(
  dir: string,
  files: readonly string[],
  server: { readonly root: string; readonly base: string },
  modified: (path: string) => number,
): string {
  const urls: Record<string, string> = {};
  for (const file of files) {
    const path = join(dir, file);
    const fromRoot = relative(server.root, path);
    const url = fromRoot.startsWith("..")
      ? `/@fs/${path.split(sep).join("/").replace(/^\//, "")}`
      : `${server.base}${fromRoot.split(sep).join("/")}`;
    urls[nameOf(file)] = `${url}?t=${String(Math.round(modified(path)))}`;
  }
  return `export default ${JSON.stringify(urls)};\n`;
}

/** The Vite plugin of the module of the pictures in `folder`. */
export function labsStills(folder: string): Plugin {
  const dir = resolve(folder);
  let command: "serve" | "build" = "serve";
  let server = { root: process.cwd(), base: "/" };
  return {
    name: "scenity-labs-stills",
    configResolved(config) {
      command = config.command;
      server = { root: config.root, base: config.base };
    },
    resolveId(id) {
      return id === STILLS_MODULE ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const files = pictures(dir);
      return command === "build"
        ? buildModule(dir, files)
        : devModule(dir, files, server, (path) => statSync(path).mtimeMs);
    },
    hotUpdate({ file, modules }) {
      if (this.environment.name !== "client") return;
      if (!file.endsWith(".webp") || resolve(dirname(file)) !== dir) return;
      const module = this.environment.moduleGraph.getModuleById(RESOLVED);
      if (module === undefined) return;
      this.environment.moduleGraph.invalidateModule(module);
      // The importers of the module (the dock) take the new URLs.
      return [...modules, module];
    },
  };
}
