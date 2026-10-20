// SPDX-License-Identifier: Apache-2.0
/**
 * The import check of a packed package, a part of `bun tools/release.ts`.
 *
 * An installed package has only the files of its tarball and the packages of its manifest. So each module of the
 * tarball (`.ts`, `.vue`, `.js`, `.mjs`; no test file) must import:
 *
 * - a relative path only to a file in the tarball (not into another workspace folder, not to a file that the `files`
 *   field leaves out);
 * - a bare name only of the package itself, of a dependency, a peer dependency or an optional dependency, or of a
 *   runtime module (`node:`, `bun`, `virtual:` modules of a Vite plugin).
 *
 * The Bun transpiler gives the imports of a module, so a type import and the text of a string or a comment do not
 * count.
 */
import { builtinModules } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** The module files that the check reads. */
const MODULE_FILE = /\.(ts|vue|js|mjs)$/;
const TEST_FILE = /\.(test|spec|vitest)\.ts$/;
/** The specifiers of runtime modules and of URLs. */
const RUNTIME = /^(node:|bun:|bun$|virtual:|\/|https?:|data:|\0)/;
/** The extensions that a relative import can leave out. */
const EXTENSIONS = ["", ".ts", ".vue", ".js", ".mjs", "/index.ts", "/index.js"];
const BUILTINS = new Set(builtinModules);

type Manifest = Readonly<Record<string, unknown>> & { readonly name?: string };

/** The package name of a bare specifier (`@scope/name` or `name`). */
export function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** The script text of a module file: the `<script>` blocks of a Vue file, else the file with no shebang line. */
export function scriptText(path: string, text: string): string {
  if (!path.endsWith(".vue")) return text.replace(/^#!.*/, "");
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "").join("\n");
}

/** The module files of a package folder, relative to it with "/". */
export function moduleFiles(dir: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })]
    .map((path) => path.split(sep).join("/"))
    .filter((path) => MODULE_FILE.test(path) && !TEST_FILE.test(path) && !path.split("/").includes("node_modules"))
    .sort();
}

function declaredNames(manifest: Manifest): Set<string> {
  const fields = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
  const names = fields.flatMap((field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}));
  return new Set([...(manifest.name === undefined ? [] : [manifest.name]), ...names]);
}

function fileExists(path: string): boolean {
  return EXTENSIONS.some((extension) => existsSync(path + extension) && statSync(path + extension).isFile());
}

/** The problems of the imports of the module files of an unpacked package folder. */
export function importProblems(dir: string, label: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
  const declared = declaredNames(manifest);
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const root = resolve(dir);
  const problems: string[] = [];
  for (const file of moduleFiles(root)) {
    const text = scriptText(file, readFileSync(join(root, file), "utf8"));
    let imports: readonly { readonly path: string }[];
    try {
      imports = transpiler.scanImports(text);
    } catch (error) {
      problems.push(`${label}: ${file} does not parse: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const { path } of imports) {
      const specifier = path.split("?")[0] ?? path;
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(join(root, file)), specifier);
        if (!target.startsWith(`${root}${sep}`))
          problems.push(`${label}: ${file} imports ${specifier} outside the package`);
        else if (!fileExists(target)) {
          problems.push(`${label}: ${file} imports ${relative(root, target)}, which is not in the tarball`);
        }
      } else if (!RUNTIME.test(specifier) && !BUILTINS.has(specifier) && !declared.has(packageName(specifier))) {
        problems.push(`${label}: ${file} imports ${specifier}, which the manifest does not declare`);
      }
    }
  }
  return problems;
}
